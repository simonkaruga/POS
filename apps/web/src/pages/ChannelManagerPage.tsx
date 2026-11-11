import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Globe, BedDouble, X, Loader2, RefreshCw, Copy, Check } from 'lucide-react';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/auth';

// ─── Types ────────────────────────────────────────────────────────────────────

type BookingStatus = 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED';
type Channel = 'BOOKING_COM' | 'AIRBNB' | 'EXPEDIA' | 'DIRECT' | 'OTHER';

interface ChannelBooking {
  id: string;
  channel: Channel;
  guestName: string;
  guestEmail?: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  amountCents: number;
  status: BookingStatus;
  roomBookingId?: string;
  externalRef?: string;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: BookingStatus) {
  const map: Record<BookingStatus, string> = {
    PENDING: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    CONFIRMED: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    CHECKED_IN: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    CHECKED_OUT: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  };
  return map[status] ?? 'bg-gray-100 text-gray-600';
}

function channelBadge(channel: Channel) {
  const map: Record<Channel, string> = {
    BOOKING_COM: 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300',
    AIRBNB: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
    EXPEDIA: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    DIRECT: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    OTHER: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  };
  return map[channel] ?? 'bg-gray-100 text-gray-600';
}

function channelLabel(ch: Channel) {
  const map: Record<Channel, string> = {
    BOOKING_COM: 'Booking.com',
    AIRBNB: 'Airbnb',
    EXPEDIA: 'Expedia',
    DIRECT: 'Direct',
    OTHER: 'Other',
  };
  return map[ch] ?? ch;
}

function fmt(cents: number) {
  return `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
}

const CHANNELS: Array<{ value: Channel; label: string; color: string }> = [
  { value: 'BOOKING_COM', label: 'Booking.com', color: '#0070f3' },
  { value: 'AIRBNB', label: 'Airbnb', color: '#FF5A5F' },
  { value: 'EXPEDIA', label: 'Expedia', color: '#FFC107' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function ChannelManagerPage() {
  const user = useAuthStore((s) => s.user);
  const businessId = user?.businessId ?? '';
  const storeId = user?.storeId ?? '';
  const qc = useQueryClient();

  const [tab, setTab] = useState<'bookings' | 'settings'>('bookings');
  const [channelFilter, setChannelFilter] = useState<Channel | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<BookingStatus | 'ALL'>('ALL');
  const [assignModal, setAssignModal] = useState<ChannelBooking | null>(null);
  const [roomBookingId, setRoomBookingId] = useState('');
  const [copiedChannel, setCopiedChannel] = useState<string | null>(null);

  // ─── Queries ──────────────────────────────────────────────────────────────

  const { data: bookings = [], isLoading, refetch } = useQuery<ChannelBooking[]>({
    queryKey: ['channel-bookings', businessId, channelFilter, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams({ businessId });
      if (channelFilter !== 'ALL') params.set('channel', channelFilter);
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      return api.get(`/integrations/channel/bookings?${params.toString()}`);
    },
    enabled: !!businessId,
  });

  // ─── Mutations ────────────────────────────────────────────────────────────

  const assignMut = useMutation({
    mutationFn: ({ id, roomBookingId }: { id: string; roomBookingId: string }) =>
      api.patch(`/integrations/channel/bookings/${id}/assign-room`, { roomBookingId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channel-bookings'] });
      setAssignModal(null);
      setRoomBookingId('');
    },
  });

  function copyWebhook(channel: string) {
    const url = `https://api.faidapos.com/api/v1/integrations/channel/webhook/${channel.toLowerCase()}?businessId=${businessId}&storeId=${storeId}`;
    navigator.clipboard.writeText(url);
    setCopiedChannel(channel);
    setTimeout(() => setCopiedChannel(null), 2000);
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap gap-3 items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Globe className="w-6 h-6 text-blue-500" />
            Channel Manager
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Hotel bookings from Booking.com, Airbnb, Expedia and more
          </p>
        </div>
        {tab === 'bookings' && (
          <button
            onClick={() => refetch()}
            className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" aria-label="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex overflow-x-auto [&>button]:shrink-0 [&>button]:whitespace-nowrap gap-1 mb-6 border-b border-gray-200 dark:border-gray-700">
        {(['bookings', 'settings'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {t === 'bookings' ? 'Bookings' : 'Settings'}
          </button>
        ))}
      </div>

      {/* Bookings tab */}
      {tab === 'bookings' && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-3 mb-4">
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value as Channel | 'ALL')}
              className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" aria-label="Filter by channels">
              <option value="ALL">All Channels</option>
              {CHANNELS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
              <option value="DIRECT">Direct</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as BookingStatus | 'ALL')}
              className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" aria-label="Filter by statuses">
              <option value="ALL">All Statuses</option>
              <option value="PENDING">Pending</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="CHECKED_IN">Checked In</option>
              <option value="CHECKED_OUT">Checked Out</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
          ) : bookings.length === 0 ? (
            <div className="text-center py-16 text-gray-400 dark:text-gray-500">
              <BedDouble className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No bookings found</p>
              <p className="text-sm mt-1">Configure your channel webhooks in the Settings tab</p>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Channel</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Guest</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Check-in</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Check-out</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Nights</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Amount</th>
                      <th className="text-center px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Status</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {bookings.map((b) => (
                      <tr key={b.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${channelBadge(b.channel)}`}>
                            {channelLabel(b.channel)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900 dark:text-white">{b.guestName}</p>
                          {b.guestEmail && <p className="text-xs text-gray-400">{b.guestEmail}</p>}
                          {b.externalRef && <p className="text-xs text-gray-400">Ref: {b.externalRef}</p>}
                        </td>
                        <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                          {new Date(b.checkIn).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                          {new Date(b.checkOut).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{b.nights}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">
                          {fmt(b.amountCents)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${statusBadge(b.status)}`}>
                            {b.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {!b.roomBookingId && b.status !== 'CANCELLED' && (
                            <button
                              onClick={() => { setAssignModal(b); setRoomBookingId(''); }}
                              className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
                            >
                              Assign Room
                            </button>
                          )}
                          {b.roomBookingId && (
                            <span className="text-xs text-green-600 dark:text-green-400">Room assigned</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Settings tab */}
      {tab === 'settings' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Configure these webhook URLs in your OTA extranet to receive bookings automatically.
          </p>
          {CHANNELS.map((ch) => {
            const url = `https://api.faidapos.com/api/v1/integrations/channel/webhook/${ch.value.toLowerCase()}?businessId=${businessId}&storeId=${storeId}`;
            const copied = copiedChannel === ch.value;
            return (
              <div key={ch.value} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: ch.color }}
                  />
                  <h3 className="font-semibold text-gray-900 dark:text-white">{ch.label}</h3>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Webhook URL for {ch.label} extranet:</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={url}
                    className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs font-mono focus:outline-none"
                  />
                  <button
                    onClick={() => copyWebhook(ch.value)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                      copied
                        ? 'bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700 text-green-700 dark:text-green-400'
                        : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Assign Room Modal */}
      {assignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Assign Room</h2>
              <button onClick={() => setAssignModal(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Booking for <strong className="text-gray-900 dark:text-white">{assignModal.guestName}</strong>
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Room Booking ID *
                </label>
                <input
                  type="text"
                  value={roomBookingId}
                  onChange={(e) => setRoomBookingId(e.target.value)}
                  placeholder="Enter hotel room booking ID"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {assignMut.isError && (
                <p className="text-sm text-red-500">Failed to assign room. Please try again.</p>
              )}
              <div className="flex gap-3">
                <button
                  onClick={() => setAssignModal(null)}
                  className="flex-1 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => assignMut.mutate({ id: assignModal.id, roomBookingId })}
                  disabled={!roomBookingId.trim() || assignMut.isPending}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  {assignMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  Assign
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
