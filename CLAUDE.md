# CLAUDE.md - Izerebar Development Guidelines

## MANDATORY RULES - FOLLOW ALWAYS

### 1. Documentation First - ALWAYS

Before writing ANY code, you MUST:

1. **Read `ARCHITECTURE.md`** - Understand the full system design
2. **Read `REQUIREMENTS.md`** - Understand the business rules
3. **Read `codeing_mathodology.md`** - Follow the development process

**Never assume. Never guess. Always reference the docs.**

---

### 2. Layered Development - STRICT ORDER

Development MUST proceed in this exact order. Each layer is LOCKED before moving to the next.

```
1. DATABASE LAYER     → Schema, indexes, constraints, triggers, RLS
2. DOMAIN/SERVICE LAYER → Business logic, validations, workflows
3. API LAYER          → Endpoints, auth, input validation
4. UI LAYER           → Frontend (Phase 2)
```

**DO NOT skip layers. DO NOT implement API before database is complete and tested.**

---

### 3. Architecture Compliance - MANDATORY

Every implementation MUST comply with `ARCHITECTURE.md`:

- **Append-only events** - No DELETE, no UPDATE on core tables
- **Full traceability** - Every action logs: user_id, device_id, role, timestamp, reason
- **Offline-tolerant** - Use sync queue pattern from Section 5
- **Role-based access** - Follow permissions matrix from Section 8.2

**If the architecture doesn't cover something, ASK before implementing.**

---

### 4. Testing - NON-NEGOTIABLE

For each layer:

| Layer | Required Tests |
|-------|---------------|
| Database | Schema tests, constraint tests, trigger tests, RLS tests |
| Domain | Unit tests for every function, integration tests with DB |
| API | Endpoint tests, auth tests, validation tests |

**Minimum 90% code coverage. No exceptions.**

**TDD approach: Write tests BEFORE implementation when possible.**

---

### 5. Code Standards

```typescript
// Every function must reference what it implements
/**
 * Creates a new sale record
 * @implements ARCHITECTURE.md Section 3.3 - Sale State Machine
 * @implements REQUIREMENTS.md Section 4 - Sale concept
 */
async function createSale(input: CreateSaleInput): Promise<Sale> {
  // Implementation
}
```

- **No hardcoded values** - Use environment variables or config
- **No magic numbers** - Define constants with clear names
- **Security first** - Validate inputs, escape outputs, never trust client data
- **Clean code** - Readable, maintainable, well-commented

---

### 6. Local Development Setup

**Stack:**
- Database: PostgreSQL (via Docker)
- Backend: Supabase Edge Functions (Deno) OR Node.js
- Testing: Vitest / Jest
- Local Supabase: supabase CLI with local Docker

**Commands:**
```bash
# Start local Supabase
supabase start

# Run migrations
supabase db push

# Run tests
npm test

# Check types
npm run typecheck
```

---

### 7. Git Workflow & Version Control

**Repository:** `https://github.com/bahatiirene1/izerebar.git`

#### Branch Strategy

| Branch | Purpose | Protection |
|--------|---------|------------|
| `main` | Production-ready code | Protected - requires PR + CI pass |
| `develop` | Integration branch | Protected - requires CI pass |
| `feature/*` | New features | No protection |
| `fix/*` | Bug fixes | No protection |
| `hotfix/*` | Urgent production fixes | Requires approval |

#### Branch Naming Convention

```
feature/db-schema
feature/auth-service
feature/sales-api
fix/stock-validation
hotfix/payment-confirmation
```

#### Commit Message Format

```
<type>(<scope>): <short description>

<body - what and why>

Implements: ARCHITECTURE.md Section X.X
```

**Types:** `feat`, `fix`, `docs`, `test`, `refactor`, `chore`

**Example:**
```
feat(db): add sales table with constraints

Implements ARCHITECTURE.md Section 2.3.11
- Added sales table with all columns
- Added indexes for common queries
- Added constraint for reversal reason
```

#### Rules

- **NEVER commit directly to main** - Always use feature branches
- **NEVER commit secrets** - Use .env files (gitignored)
- **ALWAYS reference architecture** in commit messages
- **ALWAYS ensure CI passes** before merging

---

### 8. CI/CD - Strict Gates (MANDATORY)

All code must pass these gates before merging:

| Gate | Description | Failure = Block |
|------|-------------|-----------------|
| **Lint** | Code style & formatting | Yes |
| **Type Check** | TypeScript compilation | Yes |
| **Database Tests** | Schema, constraints, RLS | Yes |
| **Unit Tests** | Function-level tests | Yes |
| **Integration Tests** | Cross-layer tests | Yes |
| **Security Scan** | Vulnerabilities, secrets | Yes |

**CI runs on:** Every push to `main`, `develop`, and all PRs

**If ANY gate fails, the merge is BLOCKED.**

See `.github/workflows/ci.yml` for full configuration.

---

### 9. Layer Locking Protocol

A layer is LOCKED when:

1. All tables/functions/endpoints are implemented
2. All tests pass (90%+ coverage)
3. Manual review completed
4. Documented in a CHANGELOG

**Once locked, changes require:**
- Formal justification
- Impact analysis
- Full re-testing

---

### 10. Current Development Phase

**Phase: DATABASE LAYER**

Focus:
1. Set up local Supabase with Docker
2. Implement all tables from `ARCHITECTURE.md` Section 2
3. Implement all enums, constraints, indexes
4. Implement RLS policies
5. Implement database functions
6. Write and pass all schema tests
7. LOCK database layer

**DO NOT proceed to Domain layer until Database is locked.**

---

### 11. File Structure (Target)

```
izerebar/
├── .github/
│   └── workflows/
│       └── ci.yml            # CI pipeline with strict gates
│
├── CLAUDE.md                 # This file - development rules
├── REQUIREMENTS.md           # Business requirements (frozen)
├── ARCHITECTURE.md           # Technical architecture (frozen)
├── codeing_mathodology.md    # Development methodology
│
├── .gitignore                # Git ignore rules
├── .env.example              # Environment template (commit this)
├── .env                      # Actual secrets (NEVER commit)
│
├── supabase/
│   ├── config.toml           # Supabase local config
│   ├── migrations/           # SQL migrations (numbered)
│   │   ├── 00001_enums.sql
│   │   ├── 00002_core_tables.sql
│   │   ├── 00003_auth_tables.sql
│   │   ├── 00004_affiliate_tables.sql
│   │   ├── 00005_indexes.sql
│   │   ├── 00006_rls_policies.sql
│   │   ├── 00007_functions.sql
│   │   └── 00008_triggers.sql
│   ├── functions/            # Edge functions
│   │   ├── auth/
│   │   ├── sync/
│   │   └── reports/
│   └── tests/                # Database tests
│
├── src/                      # Domain & API layer (later)
│   ├── domain/
│   ├── api/
│   └── utils/
│
├── tests/                    # Test files
│   ├── db/
│   ├── domain/
│   └── api/
│
└── package.json              # NPM configuration
```

---

### 12. Questions to Ask Before Coding

Before implementing anything, ask yourself:

1. Is this in the architecture? (If no, stop and ask)
2. Which layer does this belong to? (If wrong layer, stop)
3. What tests will verify this works?
4. Does this follow append-only principles?
5. Does this track user, device, timestamp, reason?
6. Is this secure? (Input validation, RLS, auth)

---

### 13. Error Handling Pattern

```typescript
// Always use Result pattern or throw descriptive errors
class DomainError extends Error {
  constructor(
    message: string,
    public code: string,
    public context?: Record<string, unknown>
  ) {
    super(message);
  }
}

// Example
throw new DomainError(
  'Cannot reverse confirmed sale',
  'SALE_ALREADY_CONFIRMED',
  { saleId, status: sale.status }
);
```

---

## REMEMBER

1. **Architecture is the source of truth**
2. **Layer by layer, test before proceeding**
3. **Append-only, full traceability, offline-first**
4. **Security is not optional**
5. **When in doubt, ask - don't assume**

---

*This file governs ALL development on Izerebar. No exceptions.*
