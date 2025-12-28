# Changelog

All notable changes to Izerebar will be documented in this file.

## [Unreleased]

### Database Layer - LOCKED (2024-12-28)

**Status:** ✅ LOCKED - No changes without formal justification and re-testing.

#### Schema (8 Migrations)
- `00001_enums.sql` - 9 PostgreSQL enums (user_role, sale_status, movement_type, etc.)
- `00002_core_tables.sql` - bars, users, devices, products, user_roles
- `00003_operational_tables.sql` - days, shifts, stock_movements, sales, events, etc.
- `00004_summaries.sql` - daily/shift summaries, materialized views
- `00005_auth_schema.sql` - auth_custom schema (phone+PIN)
- `00006_affiliate_schema.sql` - agents, commissions, payouts
- `00007_functions.sql` - 13 helper functions and triggers
- `00008_rls_policies.sql` - Row Level Security for all tables

#### Tables Created
| Schema | Tables |
|--------|--------|
| public | 17 tables (bars, users, devices, products, days, shifts, sales, etc.) |
| auth_custom | 4 tables (credentials, sessions, otp_rate_limits, device_registrations) |
| affiliate | 4 tables (agents, agent_bars, commissions, payouts) |

#### Tests (70 Passing)
- Schema tests: 26
- Constraint tests: 18
- RLS policy tests: 14
- Trigger/function tests: 12

#### Key Features Implemented
- **Append-only events table** - Full audit trail, no DELETE/UPDATE
- **Stock custody chain** - Manager → Bartender → Server tracking
- **Sales accountability** - Server assigned, bartender confirms
- **Bar isolation** - RLS ensures multi-tenant security
- **Offline sync support** - sync_status and client_id fields

---

## Layer Lock Protocol

To modify the database layer after lock:
1. Document justification in this CHANGELOG
2. Perform impact analysis
3. Update migrations (new migration, never modify existing)
4. Update all affected tests
5. Full re-testing required
6. CI must pass
