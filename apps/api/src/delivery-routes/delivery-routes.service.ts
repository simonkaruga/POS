import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DeliveryService } from '../delivery/delivery.service';
import { newDeliveryOrderNumber } from '../delivery/order-number';

interface CreateRunDto {
  routeId: string;
  date: string;
  driverUserId?: string;
  orderIds: string[];
}

interface AddExpenseDto {
  category: string;
  amountCents: number;
  description?: string;
  recordedBy: string;
}

interface CaptureProofDto {
  signatureBase64?: string;
  receivedByName: string;
  latitude?: number;
  longitude?: number;
  photoUrl?: string;
  notes?: string;
}

@Injectable()
export class DeliveryRoutesService {
  constructor(
    private prisma: PrismaService,
    private delivery: DeliveryService,
  ) {}

  async createRun(businessId: string, dto: CreateRunDto) {
    // A bad/foreign routeId would otherwise surface as an opaque FK 500.
    const route = await this.prisma.salesRoute.findFirst({
      where: { id: dto.routeId ?? '', businessId },
      select: { id: true },
    });
    if (!route) throw new BadRequestException('Select a valid route for this run');

    const orderIds = dto.orderIds ?? [];

    const run = await this.prisma.deliveryRun.create({
      data: {
        businessId,
        routeId: route.id,
        date: DeliveryRoutesService.startOfDay(dto.date),
        driverUserId: dto.driverUserId || null,
        status: 'PLANNED',
        orders: {
          create: orderIds.map((fieldOrderId, idx) => ({
            fieldOrderId,
            sortOrder: idx,
            status: 'PENDING',
          })),
        },
      },
      include: { orders: true },
    });

    // Update field orders to DISPATCHED
    if (orderIds.length > 0) {
      await this.prisma.fieldOrder.updateMany({
        where: { id: { in: orderIds }, businessId },
        data: { status: 'DISPATCHED', dispatchedAt: new Date() },
      });
    }

    await this.syncDeliveryOrders(run.id);

    return run;
  }

  async getRuns(
    businessId: string,
    filters: {
      routeId?: string;
      date?: string;
      startDate?: string;
      endDate?: string;
      status?: string;
    },
  ) {
    const where: Record<string, unknown> = { businessId };
    if (filters.routeId) where.routeId = filters.routeId;
    if (filters.status) where.status = filters.status;

    // `date` is a single day; startDate/endDate are an inclusive range (the runs
    // board sends the range, the driver app sends a single day).
    const from = filters.startDate ?? filters.date;
    const to = filters.endDate ?? filters.date;
    if (from || to) {
      const range: { gte?: Date; lt?: Date } = {};
      if (from) range.gte = DeliveryRoutesService.startOfDay(from);
      if (to) range.lt = DeliveryRoutesService.startOfNextDay(to);
      where.date = range;
    }

    const runs = await this.prisma.deliveryRun.findMany({
      where,
      orderBy: { date: 'desc' },
      include: {
        route: { select: { id: true, name: true, color: true } },
        driver: { select: { id: true, name: true } },
        orders: { select: { fieldOrder: { select: { totalCents: true } } } },
        expenses: { select: { amountCents: true } },
      },
    });

    // Clients render a flat card (route name, driver, order count, value) — keep the
    // nested relations too so existing callers reading `run.route` keep working.
    return runs.map(({ orders, expenses, ...run }) => ({
      ...run,
      routeName: run.route?.name ?? null,
      driverName: run.driver?.name ?? null,
      orderCount: orders.length,
      totalCents: orders.reduce((s, o) => s + (o.fieldOrder?.totalCents ?? 0), 0),
      expenseTotalCents: expenses.reduce((s, e) => s + e.amountCents, 0),
      _count: { orders: orders.length },
    }));
  }

  async getRun(id: string, businessId: string) {
    const run = await this.prisma.deliveryRun.findFirst({
      where: { id, businessId },
      include: {
        route: true,
        driver: { select: { id: true, name: true, phone: true } },
        orders: {
          orderBy: { sortOrder: 'asc' },
          include: {
            fieldOrder: {
              include: {
                customer: {
                  select: {
                    id: true,
                    name: true,
                    phone: true,
                    shopCode: true,
                    gpsLat: true,
                    gpsLng: true,
                  },
                },
                items: true,
              },
            },
            proof: true,
          },
        },
        expenses: true,
      },
    });
    if (!run) throw new NotFoundException('Delivery run not found');

    const orders = run.orders.map((o) => ({
      ...o,
      orderNumber: o.fieldOrder?.orderNumber ?? null,
      customerName: o.fieldOrder?.customer?.name ?? null,
      totalCents: o.fieldOrder?.totalCents ?? 0,
    }));

    return {
      ...run,
      routeName: run.route?.name ?? null,
      driverName: run.driver?.name ?? null,
      orders,
      orderCount: orders.length,
      totalCents: orders.reduce((s, o) => s + o.totalCents, 0),
      expenseTotalCents: run.expenses.reduce((s, e) => s + e.amountCents, 0),
    };
  }

  /**
   * Attach an already-packed field order to an existing (not yet completed) run.
   * Used by the "Add to Delivery Run" action on the field-orders board.
   */
  async addOrderToRun(runId: string, businessId: string, fieldOrderId: string) {
    const run = await this.prisma.deliveryRun.findFirst({
      where: { id: runId, businessId },
    });
    if (!run) throw new NotFoundException('Delivery run not found');
    if (run.status === 'COMPLETED' || run.status === 'CANCELLED') {
      throw new BadRequestException(`Cannot add orders to a ${run.status.toLowerCase()} run`);
    }

    const order = await this.prisma.fieldOrder.findFirst({
      where: { id: fieldOrderId, businessId },
    });
    if (!order) throw new NotFoundException('Field order not found');
    if (order.status === 'CANCELLED') {
      throw new BadRequestException('Cannot dispatch a cancelled order');
    }
    if (order.status === 'DELIVERED') {
      throw new BadRequestException('Order has already been delivered');
    }

    const existing = await this.prisma.deliveryRunOrder.findFirst({
      where: { fieldOrderId, deliveryRun: { status: { notIn: ['COMPLETED', 'CANCELLED'] } } },
    });
    if (existing) {
      throw new BadRequestException(
        existing.deliveryRunId === runId
          ? 'Order is already on this run'
          : 'Order is already assigned to another active delivery run',
      );
    }

    const last = await this.prisma.deliveryRunOrder.findFirst({
      where: { deliveryRunId: runId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    const runOrder = await this.prisma.deliveryRunOrder.create({
      data: {
        deliveryRunId: runId,
        fieldOrderId,
        sortOrder: (last?.sortOrder ?? -1) + 1,
        status: 'PENDING',
      },
    });

    await this.prisma.fieldOrder.update({
      where: { id: fieldOrderId },
      data: { status: 'DISPATCHED', dispatchedAt: new Date() },
    });

    await this.syncDeliveryOrders(runId);

    return runOrder;
  }

  /**
   * Project a run's stops into `DeliveryOrder` rows.
   *
   * Field/agent orders live on `FieldOrder` + `DeliveryRunOrder`, but the Faida Driver
   * app reads its job list from `DeliveryOrder`. Without this projection a dispatched
   * field order never reaches the driver's phone. One delivery per field order, kept
   * in step with the run's driver.
   */
  private async syncDeliveryOrders(runId: string): Promise<void> {
    const run = await this.prisma.deliveryRun.findUnique({
      where: { id: runId },
      include: {
        orders: {
          include: {
            fieldOrder: {
              include: {
                customer: {
                  select: {
                    name: true,
                    phone: true,
                    gpsLat: true,
                    gpsLng: true,
                    shopCode: true,
                    addresses: {
                      where: { isDefault: true },
                      take: 1,
                      select: { address: true, lat: true, lng: true },
                    },
                  },
                },
                items: true,
              },
            },
          },
        },
      },
    });
    if (!run) return;

    for (const runOrder of run.orders) {
      const fo = runOrder.fieldOrder;
      if (!fo) continue;

      const existing = await this.prisma.deliveryOrder.findFirst({
        where: { fieldOrderId: fo.id },
      });

      if (existing) {
        // Keep the driver assignment in step; never downgrade a completed delivery.
        if (existing.status !== 'DELIVERED' && existing.status !== 'CANCELLED') {
          await this.prisma.deliveryOrder.update({
            where: { id: existing.id },
            data: {
              driverId: run.driverUserId ?? existing.driverId,
              status: run.driverUserId && existing.status === 'PENDING' ? 'ASSIGNED' : existing.status,
              scheduledAt: run.date,
            },
          });
        }
        continue;
      }

      const lat = fo.customer?.gpsLat ?? fo.customer?.addresses?.[0]?.lat ?? undefined;
      const lng = fo.customer?.gpsLng ?? fo.customer?.addresses?.[0]?.lng ?? undefined;
      const feeCents =
        lat != null && lng != null
          ? (await this.delivery.calcDeliveryFee(fo.businessId, lat, lng)).feeCents
          : 0;

      const storeId =
        fo.storeId ??
        (
          await this.prisma.store.findFirst({
            where: { businessId: fo.businessId },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
          })
        )?.id;
      if (!storeId) continue;

      await this.prisma.deliveryOrder.create({
        data: {
          // Derived from the field order's number before, which is sequential and
          // therefore enumerable on the public tracking page.
          orderNumber: newDeliveryOrderNumber(),
          businessId: fo.businessId,
          storeId,
          fieldOrderId: fo.id,
          customerId: fo.customerId,
          customerName: fo.customer?.name ?? 'Customer',
          customerPhone: fo.customer?.phone ?? undefined,
          deliveryAddress:
            fo.customer?.addresses?.[0]?.address ??
            (fo.customer?.shopCode ? `Shop ${fo.customer.shopCode}` : 'See route sheet'),
          lat: fo.customer?.gpsLat ?? fo.customer?.addresses?.[0]?.lat ?? undefined,
          lng: fo.customer?.gpsLng ?? fo.customer?.addresses?.[0]?.lng ?? undefined,
          driverId: run.driverUserId ?? undefined,
          status: run.driverUserId ? 'ASSIGNED' : 'PENDING',
          channel: 'FIELD',
          scheduledAt: run.date,
          subtotalCents: fo.subtotalCents,
          taxCents: fo.vatCents,
          totalCents: fo.totalCents,
          // Projected deliveries never carried a fee, so every field-order delivery
          // showed KES 0 on the dispatch board. Priced the same way a POS delivery
          // is — by zone, when the customer has coordinates.
          deliveryFeeCents: feeCents,
          paymentStatus: fo.paymentStatus === 'PAID' ? 'PAID' : 'UNPAID',
          notes: fo.notes ?? undefined,
          items: {
            create: fo.items.map((i) => ({
              itemId: i.itemId,
              name: i.itemName,
              quantity: i.quantity,
              unitPriceCents: i.unitPriceCents,
              totalCents: i.totalCents,
            })),
          },
        },
      });
    }
  }

  /** Detach an order from a run and return it to PACKED so it can be re-dispatched. */
  async removeOrderFromRun(runOrderId: string, businessId: string) {
    const runOrder = await this.prisma.deliveryRunOrder.findFirst({
      where: { id: runOrderId, deliveryRun: { businessId } },
    });
    if (!runOrder) throw new NotFoundException('Delivery run order not found');
    if (runOrder.status === 'DELIVERED') {
      throw new BadRequestException('Cannot remove an order that has already been delivered');
    }

    await this.prisma.deliveryRunOrder.delete({ where: { id: runOrderId } });
    await this.prisma.fieldOrder.update({
      where: { id: runOrder.fieldOrderId },
      data: { status: 'PACKED', dispatchedAt: null },
    });
    await this.prisma.deliveryOrder.updateMany({
      where: { fieldOrderId: runOrder.fieldOrderId, status: { notIn: ['DELIVERED'] } },
      data: { status: 'CANCELLED' },
    });

    return { removed: true };
  }

  async addExpense(
    deliveryRunId: string,
    businessId: string,
    dto: AddExpenseDto,
  ) {
    // Verify run belongs to business
    const run = await this.prisma.deliveryRun.findFirst({
      where: { id: deliveryRunId, businessId },
    });
    if (!run) throw new NotFoundException('Delivery run not found');

    if (!dto.recordedBy) {
      throw new BadRequestException('recordedBy is required');
    }
    const amountCents = Math.round(Number(dto.amountCents));
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      throw new BadRequestException('Expense amount must be greater than zero');
    }
    if (!dto.category) {
      throw new BadRequestException('Expense category is required');
    }

    return this.prisma.routeExpense.create({
      data: {
        businessId,
        deliveryRunId,
        category: dto.category,
        amountCents,
        description: dto.description ?? null,
        recordedBy: dto.recordedBy,
      },
    });
  }

  async captureProof(
    deliveryRunOrderId: string,
    businessId: string,
    dto: CaptureProofDto,
  ) {
    const runOrder = await this.prisma.deliveryRunOrder.findFirst({
      where: { id: deliveryRunOrderId, deliveryRun: { businessId } },
      include: { fieldOrder: { select: { id: true } } },
    });
    if (!runOrder) throw new NotFoundException('Delivery run order not found');

    // Check existing proof
    const existing = await this.prisma.deliveryProof.findUnique({
      where: { deliveryRunOrderId },
    });
    if (existing) {
      throw new BadRequestException('Proof already captured for this order');
    }

    const proof = await this.prisma.deliveryProof.create({
      data: {
        fieldOrderId: runOrder.fieldOrderId,
        deliveryRunOrderId,
        signatureBase64: dto.signatureBase64,
        receivedByName: dto.receivedByName,
        latitude: dto.latitude,
        longitude: dto.longitude,
        photoUrl: dto.photoUrl,
        notes: dto.notes,
      },
    });

    // Update run order status
    await this.prisma.deliveryRunOrder.update({
      where: { id: deliveryRunOrderId },
      data: { status: 'DELIVERED', deliveredAt: new Date() },
    });

    // Update field order status
    await this.prisma.fieldOrder.update({
      where: { id: runOrder.fieldOrderId },
      data: { status: 'DELIVERED', deliveredAt: new Date() },
    });

    // Close out the driver-app copy so the same stop is not shown as outstanding.
    await this.prisma.deliveryOrder.updateMany({
      where: { fieldOrderId: runOrder.fieldOrderId, status: { notIn: ['DELIVERED', 'CANCELLED'] } },
      data: {
        status: 'DELIVERED',
        deliveredAt: new Date(),
        receivedBy: dto.receivedByName,
        proofPhotoUrl: dto.photoUrl,
        lat: dto.latitude,
        lng: dto.longitude,
      },
    });

    return proof;
  }

  async markRunComplete(id: string, businessId: string) {
    const run = await this.prisma.deliveryRun.findFirst({
      where: { id, businessId },
    });
    if (!run) throw new NotFoundException('Delivery run not found');
    if (run.status === 'COMPLETED') {
      throw new BadRequestException('Run is already completed');
    }

    return this.prisma.deliveryRun.update({
      where: { id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
  }

  async getRouteProfitability(
    businessId: string,
    filters: { startDate: string; endDate: string },
  ) {
    const start = new Date(filters.startDate);
    const end = new Date(filters.endDate);

    // Get all routes
    const routes = await this.prisma.salesRoute.findMany({
      where: { businessId, isActive: true },
      select: { id: true, name: true, color: true, deliveryDays: true },
    });

    const results = await Promise.all(
      routes.map(async (route) => {
        // Orders on route in period
        const orders = await this.prisma.fieldOrder.findMany({
          where: {
            businessId,
            routeId: route.id,
            createdAt: { gte: start, lte: end },
            status: { not: 'CANCELLED' },
          },
          select: { id: true, totalCents: true, status: true },
        });

        const totalOrdersCents = orders.reduce((s, o) => s + o.totalCents, 0);
        const deliveredOrdersCents = orders
          .filter((o) => o.status === 'DELIVERED')
          .reduce((s, o) => s + o.totalCents, 0);

        // Expenses on runs for this route in period
        const expensesAgg = await this.prisma.routeExpense.aggregate({
          where: {
            businessId,
            deliveryRun: {
              routeId: route.id,
              date: { gte: start, lte: end },
            },
          },
          _sum: { amountCents: true },
        });
        const expensesCents = expensesAgg._sum.amountCents ?? 0;

        // Top items
        const items = await this.prisma.fieldOrderItem.findMany({
          where: {
            fieldOrder: {
              businessId,
              routeId: route.id,
              createdAt: { gte: start, lte: end },
              status: { not: 'CANCELLED' },
            },
          },
          select: { itemId: true, itemName: true, quantity: true, totalCents: true },
        });

        const itemMap: Record<
          string,
          { itemName: string; totalQty: number; totalCents: number }
        > = {};
        for (const item of items) {
          const key = item.itemId ?? item.itemName;
          if (!itemMap[key]) {
            itemMap[key] = {
              itemName: item.itemName,
              totalQty: 0,
              totalCents: 0,
            };
          }
          itemMap[key].totalQty += item.quantity;
          itemMap[key].totalCents += item.totalCents;
        }
        const topItems = Object.values(itemMap)
          .sort((a, b) => b.totalCents - a.totalCents)
          .slice(0, 10);

        return {
          routeId: route.id,
          routeName: route.name,
          color: route.color,
          deliveryDays: DeliveryRoutesService.parseDays(route.deliveryDays),
          totalOrdersCents,
          deliveredOrdersCents,
          expensesCents,
          netProfitCents: deliveredOrdersCents - expensesCents,
          ordersCount: orders.length,
          topItems,
        };
      }),
    );

    return results;
  }

  /** `DeliveryRun.date` is a DATE column — compare against day boundaries, not timestamps. */
  private static startOfDay(raw: string): Date {
    const d = new Date(raw);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private static startOfNextDay(raw: string): Date {
    const d = DeliveryRoutesService.startOfDay(raw);
    d.setDate(d.getDate() + 1);
    return d;
  }

  /** `SalesRoute.deliveryDays` is a JSON-encoded string array — never let a bad value throw. */
  private static parseDays(raw: string | null | undefined): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
}
