#!/usr/bin/env bash
#
# End-to-end check of channel-scoped roles (OSS-300 / #3095) against a running dev server.
#
#   API=https://vendure.localhost/admin-api ./verify.sh
#
# Requires `authOptions.channelScopedRoles: true` and both example plugins registered in dev-config.ts.
# Idempotent: re-running reuses the channels/roles/admins it created.
set -uo pipefail

API="${API:-https://vendure.localhost/admin-api}"
PASS=0
FAIL=0

login() {
    curl -ksi "$API" -X POST -H 'content-type: application/json' \
        -d "{\"query\":\"mutation { login(username:\\\"$1\\\", password:\\\"$2\\\"){ ... on CurrentUser { id } ... on ErrorResult { errorCode message } } }\"}" |
        grep -i '^vendure-auth-token:' | tr -d '\r' | awk '{print $2}'
}

# q <token> <json-body> [channel-token]
q() {
    if [ -n "${3:-}" ]; then
        curl -ks "$API" -X POST -H 'content-type: application/json' \
            -H "Authorization: Bearer $1" -H "vendure-token: $3" -d "$2"
    else
        curl -ks "$API" -X POST -H 'content-type: application/json' \
            -H "Authorization: Bearer $1" -d "$2"
    fi
}

jqp() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)" 2>/dev/null; }

check() { # check <label> <actual> <expected>
    if [ "$2" = "$3" ]; then
        echo "  PASS  $1"
        PASS=$((PASS + 1))
    else
        echo "  FAIL  $1 — expected [$3] got [$2]"
        FAIL=$((FAIL + 1))
    fi
}

SU=$(login superadmin superadmin)
if [ -z "$SU" ]; then
    echo "Could not log in as superadmin at $API"
    exit 1
fi

flag=$(q "$SU" '{"query":"{ globalSettings { serverConfig { channelScopedRoles } } }"}' |
    jqp "str(d['data']['globalSettings']['serverConfig']['channelScopedRoles']).lower()")
check "channelScopedRoles is enabled" "$flag" "true"
[ "$flag" = "true" ] || { echo "Enable authOptions.channelScopedRoles and restart."; exit 1; }

# ---------------------------------------------------------------- fixtures

channel_id() { # channel_id <code>
    q "$SU" "{\"query\":\"{ channels(options:{filter:{code:{eq:\\\"$1\\\"}}}) { items { id token } } }\"}" |
        jqp "d['data']['channels']['items'][0]['$2'] if d['data']['channels']['items'] else ''"
}
ensure_channel() {
    local id
    id=$(channel_id "$1" id)
    if [ -z "$id" ]; then
        q "$SU" "{\"query\":\"mutation { createChannel(input:{code:\\\"$1\\\", token:\\\"$1-token\\\", defaultLanguageCode: en, currencyCode: USD, pricesIncludeTax: true, defaultShippingZoneId: \\\"1\\\", defaultTaxZoneId: \\\"1\\\"}) { ... on Channel { id } ... on ErrorResult { message } } }\"}" >/dev/null
        id=$(channel_id "$1" id)
    fi
    echo "$id"
}
ensure_role() { # ensure_role <code> <permissions> <channelIds-json>
    local id
    id=$(q "$SU" "{\"query\":\"{ roles(options:{filter:{code:{eq:\\\"$1\\\"}}}) { items { id } } }\"}" |
        jqp "d['data']['roles']['items'][0]['id'] if d['data']['roles']['items'] else ''")
    if [ -z "$id" ]; then
        id=$(q "$SU" "{\"query\":\"mutation { createRole(input:{code:\\\"$1\\\", description:\\\"$1\\\", permissions:[$2], channelIds:$3}) { id } }\"}" |
            jqp "d['data']['createRole']['id']")
    fi
    echo "$id"
}
ensure_admin() { # ensure_admin <email> <channelRoles-json>
    local id
    id=$(q "$SU" "{\"query\":\"{ administrators(options:{filter:{emailAddress:{eq:\\\"$1\\\"}}}) { items { id } } }\"}" |
        jqp "d['data']['administrators']['items'][0]['id'] if d['data']['administrators']['items'] else ''")
    if [ -z "$id" ]; then
        id=$(q "$SU" "{\"query\":\"mutation { createAdministrator(input:{firstName:\\\"$1\\\", lastName:\\\"Test\\\", emailAddress:\\\"$1\\\", password:\\\"test\\\", roleIds:[], channelRoles:$2}) { id } }\"}" |
            jqp "d['data']['createAdministrator']['id']")
    else
        q "$SU" "{\"query\":\"mutation { updateAdministrator(input:{id:\\\"$id\\\", channelRoles:$2}) { id } }\"}" >/dev/null
    fi
    echo "$id"
}

CA=$(ensure_channel channel-a)
CB=$(ensure_channel channel-b)
BOTH="[\\\"$CA\\\",\\\"$CB\\\"]"

SHARED=$(ensure_role catalog-manager 'ReadCatalog, UpdateCatalog' "$BOTH")
ADMINR=$(ensure_role shop-admin 'ReadCatalog, UpdateCatalog, DeleteCatalog, CreateAdministrator, ReadAdministrator, ChannelAudit' "$BOTH")
SUPPORTR=$(ensure_role shop-support 'ReadCatalog, ReadCustomer' "$BOTH")

ensure_admin admin-a@test.com "[{roleId:\\\"$SHARED\\\", channelIds:[\\\"$CA\\\"]}]" >/dev/null
ensure_admin admin-b@test.com "[{roleId:\\\"$SHARED\\\", channelIds:[\\\"$CB\\\"]}]" >/dev/null
ensure_admin admin-mixed@test.com "[{roleId:\\\"$ADMINR\\\", channelIds:[\\\"$CA\\\"]},{roleId:\\\"$SUPPORTR\\\", channelIds:[\\\"$CB\\\"]}]" >/dev/null

# ------------------------------------- A: one shared role, two isolated admins (#3222)

echo
echo "Scenario A — one shared role, two isolated admins"
A=$(login admin-a@test.com test)
B=$(login admin-b@test.com test)
check "admin-a sees only channel-a" \
    "$(q "$A" '{"query":"{ me { channels { code } } }"}' | jqp "','.join(c['code'] for c in d['data']['me']['channels'])")" \
    "channel-a"
check "admin-b sees only channel-b" \
    "$(q "$B" '{"query":"{ me { channels { code } } }"}' | jqp "','.join(c['code'] for c in d['data']['me']['channels'])")" \
    "channel-b"
check "admin-a authorized on channel-a" \
    "$(q "$A" '{"query":"{ consumerCheckPermissions { canReadCatalog } }"}' "channel-a-token" | jqp "str(d['data']['consumerCheckPermissions']['canReadCatalog']).lower()")" \
    "true"
check "admin-a FORBIDDEN on channel-b (same shared role)" \
    "$(q "$A" '{"query":"{ consumerCheckPermissions { canReadCatalog } }"}' "channel-b-token" | jqp "d['errors'][0]['extensions']['code']")" \
    "FORBIDDEN"
check "admin-a FORBIDDEN on default channel" \
    "$(q "$A" '{"query":"{ consumerCheckPermissions { canReadCatalog } }"}' | jqp "d['errors'][0]['extensions']['code']")" \
    "FORBIDDEN"

# --------------------------------- B: one user, different roles per channel (#3095)

echo
echo "Scenario B — one user, different roles per channel"
M=$(login admin-mixed@test.com test)
check "admin role applies on channel-a" \
    "$(q "$M" '{"query":"{ consumerCheckPermissions { canCreateAdministrator } }"}' "channel-a-token" | jqp "str(d['data']['consumerCheckPermissions']['canCreateAdministrator']).lower()")" \
    "true"
check "support role only on channel-b (no admin powers)" \
    "$(q "$M" '{"query":"{ consumerCheckPermissions { canReadCatalog canCreateAdministrator } }"}' "channel-b-token" | jqp "str(d['data']['consumerCheckPermissions']['canReadCatalog']).lower()+'/'+str(d['data']['consumerCheckPermissions']['canCreateAdministrator']).lower()")" \
    "true/false"

# ------------------------------------------------------------- C: guard rails

echo
echo "Scenario C — guard rails"
check "partially-scoped role rejected in the global slot" \
    "$(q "$SU" "{\"query\":\"mutation { createAdministrator(input:{firstName:\\\"X\\\", lastName:\\\"Y\\\", emailAddress:\\\"reject-$RANDOM@test.com\\\", password:\\\"test\\\", roleIds:[\\\"$SHARED\\\"]}) { id } }\"}" |
        jqp "'rejected' if 'must be granted per Channel' in d['errors'][0]['message'] else d['errors'][0]['message']")" \
    "rejected"
check "channel-a admin cannot grant a role on channel-b" \
    "$(q "$M" "{\"query\":\"mutation { createAdministrator(input:{firstName:\\\"X\\\", lastName:\\\"Y\\\", emailAddress:\\\"esc-$RANDOM@test.com\\\", password:\\\"test\\\", roleIds:[], channelRoles:[{roleId:\\\"$SUPPORTR\\\", channelIds:[\\\"$CB\\\"]}]}) { id } }\"}" "channel-a-token" |
        jqp "'rejected' if 'sufficient permissions' in d['errors'][0]['message'] else d['errors'][0]['message']")" \
    "rejected"

# ------------------------------------------------------ D: plugin compatibility

echo
echo "Scenario D — plugin compatibility"
check "plugin custom permission reached the schema" \
    "$(q "$SU" '{"query":"{ globalSettings { serverConfig { permissions { name } } } }"}' | jqp "'yes' if any(p['name']=='ChannelAudit' for p in d['data']['globalSettings']['serverConfig']['permissions']) else 'no'")" \
    "yes"
check "plugin field resolver + core channelRoles on same type" \
    "$(q "$SU" '{"query":"{ administrators(options:{filter:{emailAddress:{eq:\"admin-mixed@test.com\"}}}) { items { channelRoleSummary channelRoles { role { code } } } } }"}' |
        jqp "str(len(d['data']['administrators']['items'][0]['channelRoles']))+'/'+('ok' if '@' in d['data']['administrators']['items'][0]['channelRoleSummary'] else 'bad')")" \
    "2/ok"
UID_A=$(q "$SU" '{"query":"{ administrators(options:{filter:{emailAddress:{eq:\"admin-a@test.com\"}}}) { items { user { id } } } }"}' | jqp "d['data']['administrators']['items'][0]['user']['id']")
check "synthetic RequestContext resolves ChannelRoles" \
    "$(q "$SU" "{\"query\":\"{ consumerSyntheticContext(userId:\\\"$UID_A\\\") { resolvedChannels } }\"}" | jqp "','.join(d['data']['consumerSyntheticContext']['resolvedChannels'])")" \
    "channel-a"
check "serializeSession() still callable with one argument" \
    "$(q "$SU" '{"query":"{ consumerSerializeSession { hasUser } }"}' | jqp "str(d['data']['consumerSerializeSession']['hasUser']).lower()")" \
    "true"
# The session-cached and DB-side permission lookups are computed independently; they must agree.
check "custom permission agrees across session and DB on channel-a" \
    "$(q "$M" '{"query":"{ runChannelAudit { grantedViaSession grantedViaDatabase } }"}' "channel-a-token" | jqp "str(d['data']['runChannelAudit']['grantedViaSession']).lower()+'/'+str(d['data']['runChannelAudit']['grantedViaDatabase']).lower()")" \
    "true/true"
check "custom permission FORBIDDEN on channel-b" \
    "$(q "$M" '{"query":"{ runChannelAudit { grantedViaSession } }"}' "channel-b-token" | jqp "d['errors'][0]['extensions']['code']")" \
    "FORBIDDEN"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
