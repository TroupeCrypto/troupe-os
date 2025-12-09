-- ============================================================================
-- TROUPE OS — INITIAL DATABASE SCHEMA (PostgreSQL)
-- Core entities for: users, roles, groups, AI agents, assets, projects,
-- accounts, ledger, marketplace, and audit logs.
-- ============================================================================

-- Run inside a transaction for safety.
BEGIN;

-- ============================================================================
-- 0. EXTENSIONS
-- ============================================================================

-- For gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. ENUM TYPES
-- ============================================================================

DO $$
BEGIN
    -- Asset types
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'asset_type_enum') THEN
        CREATE TYPE asset_type_enum AS ENUM (
            'music',
            'art',
            'collectible',
            'nft',
            'document',
            'other'
        );
    END IF;

    -- Asset lifecycle status
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'asset_status_enum') THEN
        CREATE TYPE asset_status_enum AS ENUM (
            'draft',
            'indexed',
            'published',
            'on_sale',
            'sold',
            'archived'
        );
    END IF;

    -- Transaction status (financial)
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaction_status_enum') THEN
        CREATE TYPE transaction_status_enum AS ENUM (
            'pending',
            'confirmed',
            'failed',
            'reversed'
        );
    END IF;

    -- Order status (commerce)
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status_enum') THEN
        CREATE TYPE order_status_enum AS ENUM (
            'cart',
            'pending',
            'paid',
            'fulfilled',
            'cancelled',
            'refunded'
        );
    END IF;

    -- AI agent status
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ai_agent_status_enum') THEN
        CREATE TYPE ai_agent_status_enum AS ENUM (
            'active',
            'paused',
            'retired'
        );
    END IF;

    -- Ledger line direction (double-entry)
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ledger_direction_enum') THEN
        CREATE TYPE ledger_direction_enum AS ENUM (
            'debit',
            'credit'
        );
    END IF;
END$$;

-- ============================================================================
-- 2. CORE IDENTITY: USERS, ROLES, GROUPS
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           CITEXT UNIQUE NOT NULL,
    password_hash   TEXT, -- nullable if using external auth only
    display_name    TEXT,
    handle          TEXT UNIQUE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    -- Optional auth-related data
    auth_provider   TEXT,         -- e.g. 'password', 'google', 'github', 'wallet'
    auth_provider_id TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);

-- Simple role catalog (e.g., owner, admin, editor, viewer, guest)
CREATE TABLE IF NOT EXISTS roles (
    id          SERIAL PRIMARY KEY,
    code        TEXT UNIQUE NOT NULL,   -- e.g. 'owner', 'admin', 'editor'
    name        TEXT NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Many-to-many mapping between users and roles
CREATE TABLE IF NOT EXISTS user_roles (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id     INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, role_id)
);

-- Groups / organizations / teams
CREATE TABLE IF NOT EXISTS groups (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    slug        TEXT UNIQUE,
    description TEXT,
    owner_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User membership in groups
CREATE TABLE IF NOT EXISTS group_members (
    group_id    UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_in_group TEXT, -- e.g., 'owner', 'member', 'collaborator'
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (group_id, user_id)
);

-- ============================================================================
-- 3. AI WORKFORCE: DEPARTMENTS, AGENTS, TASKS
-- ============================================================================

CREATE TABLE IF NOT EXISTS departments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        TEXT UNIQUE NOT NULL,   -- e.g. 'finance', 'security', 'creative'
    name        TEXT NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_agents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,      -- e.g. 'BB', 'Free.Willy'
    slug            TEXT UNIQUE,        -- machine-safe identifier
    description     TEXT,
    department_id   UUID REFERENCES departments(id) ON DELETE SET NULL,
    status          ai_agent_status_enum NOT NULL DEFAULT 'active',
    -- Permission and scope metadata (JSON for flexibility)
    scope           JSONB NOT NULL DEFAULT '{}'::JSONB,
    -- Optional: link to a "controller" user (human supervisor)
    supervisor_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_agents_status ON ai_agents(status);

CREATE TABLE IF NOT EXISTS ai_agent_tasks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        UUID REFERENCES ai_agents(id) ON DELETE SET NULL,
    created_by_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    title           TEXT NOT NULL,
    description     TEXT,
    status          TEXT NOT NULL DEFAULT 'pending', -- simple text; can be promoted to ENUM later
    priority        INT NOT NULL DEFAULT 0,
    metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_tasks_agent ON ai_agent_tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_ai_agent_tasks_status ON ai_agent_tasks(status);

-- ============================================================================
-- 4. PROJECTS & ASSETS
-- ============================================================================

CREATE TABLE IF NOT EXISTS projects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    slug            TEXT UNIQUE,
    description     TEXT,
    owner_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    owner_group_id  UUID REFERENCES groups(id) ON DELETE SET NULL,
    metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        owner_user_id IS NOT NULL
        OR owner_group_id IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_projects_owner_user ON projects(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_projects_owner_group ON projects(owner_group_id);

CREATE TABLE IF NOT EXISTS assets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type            asset_type_enum NOT NULL,
    status          asset_status_enum NOT NULL DEFAULT 'draft',
    title           TEXT NOT NULL,
    description     TEXT,
    source          TEXT,              -- e.g. 'upload', 'import', 'on_chain'
    owner_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    owner_group_id  UUID REFERENCES groups(id) ON DELETE SET NULL,
    project_id      UUID REFERENCES projects(id) ON DELETE SET NULL,
    -- Where the underlying media / file(s) live
    storage_uri     TEXT,              -- e.g. 's3://bucket/key' or CDN URL
    thumbnail_uri   TEXT,
    -- Structured metadata (traits, tags, on-chain refs, etc.)
    metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,
    -- Optional: external IDs or references
    external_ref    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        owner_user_id IS NOT NULL
        OR owner_group_id IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(type);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id);

-- Many-to-many: projects <-> assets (for shared assets across projects)
CREATE TABLE IF NOT EXISTS project_assets (
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    asset_id    UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    role        TEXT, -- e.g. 'primary', 'supporting', 'reference'
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (project_id, asset_id)
);

-- ============================================================================
-- 5. FINANCIAL SYSTEM: ACCOUNTS, LEDGER, TRANSACTIONS
-- ============================================================================

-- Financial accounts (per brand, user, or system)
CREATE TABLE IF NOT EXISTS accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    code            TEXT UNIQUE,       -- optional chart-of-accounts code
    description     TEXT,
    currency        TEXT NOT NULL DEFAULT 'USD', -- fiat or token symbol
    -- Owner scope: can be global (Troupe Inc.), group, or user
    owner_group_id  UUID REFERENCES groups(id) ON DELETE SET NULL,
    owner_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounts_owner_group ON accounts(owner_group_id);
CREATE INDEX IF NOT EXISTS idx_accounts_owner_user ON accounts(owner_user_id);

-- Ledger journal entry (double-entry root)
CREATE TABLE IF NOT EXISTS ledger_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    description     TEXT,
    reference_type  TEXT,    -- e.g. 'order', 'payout', 'manual_adjustment'
    reference_id    TEXT,    -- application-level reference
    created_by_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Each entry consists of lines (debit/credit)
CREATE TABLE IF NOT EXISTS ledger_lines (
    id              BIGSERIAL PRIMARY KEY,
    entry_id        UUID NOT NULL REFERENCES ledger_entries(id) ON DELETE CASCADE,
    account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    direction       ledger_direction_enum NOT NULL,
    amount          NUMERIC(36, 18) NOT NULL CHECK (amount >= 0),
    currency        TEXT NOT NULL,
    metadata        JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE INDEX IF NOT EXISTS idx_ledger_lines_entry ON ledger_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_ledger_lines_account ON ledger_lines(account_id);

-- External transaction records (e.g. payment processor, on-chain tx)
CREATE TABLE IF NOT EXISTS transactions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ledger_entry_id     UUID REFERENCES ledger_entries(id) ON DELETE SET NULL,
    source              TEXT,        -- e.g. 'stripe', 'on_chain', 'manual'
    external_id         TEXT,        -- processor ID, tx hash, etc.
    status              transaction_status_enum NOT NULL DEFAULT 'pending',
    amount              NUMERIC(36, 18) NOT NULL CHECK (amount >= 0),
    currency            TEXT NOT NULL,
    from_account_id     UUID REFERENCES accounts(id) ON DELETE SET NULL,
    to_account_id       UUID REFERENCES accounts(id) ON DELETE SET NULL,
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata            JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_ledger_entry ON transactions(ledger_entry_id);

-- ============================================================================
-- 6. MARKETPLACE & COMMERCE: PRODUCTS, LISTINGS, ORDERS
-- ============================================================================

-- Products are sellable configurations based on assets or bundles
CREATE TABLE IF NOT EXISTS products (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT NOT NULL,
    description     TEXT,
    asset_id        UUID REFERENCES assets(id) ON DELETE SET NULL,
    project_id      UUID REFERENCES projects(id) ON DELETE SET NULL,
    -- Pricing model (simple fixed price to start)
    currency        TEXT NOT NULL DEFAULT 'USD',
    unit_price      NUMERIC(36, 18) NOT NULL CHECK (unit_price >= 0),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_asset ON products(asset_id);
CREATE INDEX IF NOT EXISTS idx_products_project ON products(project_id);
CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);

-- Listings expose products to specific channels (site, drop, etc.)
CREATE TABLE IF NOT EXISTS listings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    channel         TEXT NOT NULL,    -- e.g. 'site', 'drop', 'partner'
    label           TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    starts_at       TIMESTAMPTZ,
    ends_at         TIMESTAMPTZ,
    metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listings_product ON listings(product_id);
CREATE INDEX IF NOT EXISTS idx_listings_channel ON listings(channel);
CREATE INDEX IF NOT EXISTS idx_listings_is_active ON listings(is_active);

-- Orders represent purchase flows
CREATE TABLE IF NOT EXISTS orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    status          order_status_enum NOT NULL DEFAULT 'cart',
    currency        TEXT NOT NULL DEFAULT 'USD',
    subtotal_amount NUMERIC(36, 18) NOT NULL DEFAULT 0,
    total_amount    NUMERIC(36, 18) NOT NULL DEFAULT 0,
    metadata        JSONB NOT NULL DEFAULT '{}'::JSONB, -- shipping, contact, etc.
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS order_items (
    id              BIGSERIAL PRIMARY KEY,
    order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id      UUID REFERENCES products(id) ON DELETE SET NULL,
    listing_id      UUID REFERENCES listings(id) ON DELETE SET NULL,
    quantity        INT NOT NULL CHECK (quantity > 0),
    unit_price      NUMERIC(36, 18) NOT NULL CHECK (unit_price >= 0),
    total_price     NUMERIC(36, 18) NOT NULL CHECK (total_price >= 0),
    metadata        JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- Link orders to ledger entries / transactions when financials are posted
CREATE TABLE IF NOT EXISTS order_payments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id            UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    transaction_id      UUID REFERENCES transactions(id) ON DELETE SET NULL,
    ledger_entry_id     UUID REFERENCES ledger_entries(id) ON DELETE SET NULL,
    amount              NUMERIC(36, 18) NOT NULL CHECK (amount >= 0),
    currency            TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_payments_order ON order_payments(order_id);

-- ============================================================================
-- 7. AUDIT LOGS & SYSTEM EVENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id              BIGSERIAL PRIMARY KEY,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_agent_id  UUID REFERENCES ai_agents(id) ON DELETE SET NULL,
    action          TEXT NOT NULL,   -- e.g. 'asset.created', 'order.updated'
    entity_type     TEXT,            -- e.g. 'asset', 'order', 'user'
    entity_id       TEXT,            -- UUID or other identifier
    ip_address      INET,
    user_agent      TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_user ON audit_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_agent ON audit_logs(actor_agent_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_occurred_at ON audit_logs(occurred_at);

-- ============================================================================
-- 8. TIMESTAMP TRIGGERS (UPDATED_AT)
-- ============================================================================

-- Helper function to auto-update updated_at
CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach triggers to tables with updated_at columns
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN (
              'users',
              'groups',
              'projects',
              'assets',
              'ai_agents',
              'ai_agent_tasks',
              'accounts',
              'transactions',
              'products',
              'listings',
              'orders'
          )
    LOOP
        EXECUTE format($f$
            DO $do$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_trigger
                    WHERE tgname = '%I_updated_at_trigger'
                ) THEN
                    CREATE TRIGGER %I_updated_at_trigger
                    BEFORE UPDATE ON %I
                    FOR EACH ROW
                    EXECUTE FUNCTION set_updated_at_timestamp();
                END IF;
            END;
            $do$;
        $f$, r.tablename, r.tablename, r.tablename);
    END LOOP;
END$$;

-- ============================================================================
-- 9. SAFETY CHECKS & COMMIT
-- ============================================================================

COMMIT;
