#!/bin/bash

# Debug script for field orders issue

echo "🔍 Field Orders Debug Script"
echo "============================="
echo ""

# Get token from login
echo "1. Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST "http://localhost:3010/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "waiter@premiercafe.co.ke",
    "password": "waiter123"
  }')

TOKEN=$(echo $LOGIN_RESPONSE | jq -r '.accessToken')
BUSINESS_ID=$(echo $LOGIN_RESPONSE | jq -r '.user.businessId')
AGENT_ID=$(echo $LOGIN_RESPONSE | jq -r '.user.id')

if [ "$TOKEN" = "null" ]; then
    echo "❌ Login failed"
    exit 1
fi

echo "✓ Logged in"
echo "  Business ID: $BUSINESS_ID"
echo "  Agent ID: $AGENT_ID"
echo ""

# Query orders from Agent Dashboard perspective
echo "2. Querying orders (Agent Dashboard style)..."
AGENT_ORDERS=$(curl -s -X GET "http://localhost:3010/api/v1/field-sales/orders?businessId=$BUSINESS_ID&agentId=$AGENT_ID" \
  -H "Authorization: Bearer $TOKEN")

AGENT_COUNT=$(echo $AGENT_ORDERS | jq '. | length')
echo "✓ Agent Dashboard query returned: $AGENT_COUNT orders"
if [ "$AGENT_COUNT" -gt 0 ]; then
    echo "  Sample order:"
    echo $AGENT_ORDERS | jq '.[0] | {orderNumber, status, customerName, totalCents}'
fi
echo ""

# Query orders from Field Orders page perspective
echo "3. Querying orders (Field Orders page style)..."
TODAY=$(date +%Y-%m-%d)
FIRST_OF_MONTH=$(date +%Y-%m-01)

FIELD_ORDERS=$(curl -s -X GET "http://localhost:3010/api/v1/field-sales/orders?businessId=$BUSINESS_ID&startDate=$FIRST_OF_MONTH&endDate=$TODAY" \
  -H "Authorization: Bearer $TOKEN")

FIELD_COUNT=$(echo $FIELD_ORDERS | jq '. | length')
echo "✓ Field Orders page query returned: $FIELD_COUNT orders"
if [ "$FIELD_COUNT" -gt 0 ]; then
    echo "  Sample order:"
    echo $FIELD_ORDERS | jq '.[0] | {orderNumber, status, customerName, totalCents}'
fi
echo ""

# Compare
echo "4. Analysis:"
if [ "$AGENT_COUNT" -gt 0 ] && [ "$FIELD_COUNT" -eq 0 ]; then
    echo "❌ PROBLEM FOUND: Orders exist but Field Orders page can't see them"
    echo ""
    echo "Possible causes:"
    echo "  1. Date range filter is too restrictive"
    echo "  2. Orders created today but date filter excludes them"
    echo "  3. Timezone issue with date comparison"
    echo ""
    echo "Testing without date filter..."
    NO_FILTER=$(curl -s -X GET "http://localhost:3010/api/v1/field-sales/orders?businessId=$BUSINESS_ID" \
      -H "Authorization: Bearer $TOKEN")
    NO_FILTER_COUNT=$(echo $NO_FILTER | jq '. | length')
    echo "  Without date filter: $NO_FILTER_COUNT orders"
    
    if [ "$NO_FILTER_COUNT" -gt 0 ]; then
        echo ""
        echo "✓ SOLUTION: Remove or adjust date filter on Field Orders page"
        echo "  The date range filter is excluding your orders"
    fi
elif [ "$AGENT_COUNT" -eq 0 ] && [ "$FIELD_COUNT" -eq 0 ]; then
    echo "⚠️  No orders found in database"
    echo "  Create an order from Agent Dashboard first"
elif [ "$AGENT_COUNT" -eq "$FIELD_COUNT" ]; then
    echo "✓ Both queries return same count - no issue detected"
else
    echo "⚠️  Different counts: Agent=$AGENT_COUNT, Field=$FIELD_COUNT"
    echo "  This might be due to filtering differences"
fi

echo ""
echo "5. Database check..."
echo "Checking FieldOrder table directly..."

# Try to query database directly
psql -U faida -d faida_pos -t -c "SELECT COUNT(*) FROM \"FieldOrder\" WHERE \"businessId\" = '$BUSINESS_ID';" 2>/dev/null || echo "  (Database query skipped - psql not available)"

echo ""
echo "============================="
echo "Debug complete!"
