# Kamon / SevaConnect — Data Model

Entity-relationship diagram of the live PostgreSQL schema (Neon, project `purple-cake-21252356`).
Generated from the database; key columns shown (not every column).

> **Important:** Only **7** relationships are enforced by real foreign-key constraints (solid lines below).
> The rest are **application-level** relationships — the column exists and the code joins on it, but the
> database does **not** enforce referential integrity. These are marked _(implicit)_.

```mermaid
erDiagram
    societies ||--o{ users : "has members (society_id)"
    societies ||--o{ society_services : "offers (society_id, FK)"
    societies ||--o{ staging_contracts : "in (society_id, implicit)"

    services ||--o{ society_services : "templated as (service_id, FK)"

    users ||--o| users : "preferred maid (preferred_maid_id, FK self)"
    users ||--o{ bookings : "household books (household_id, implicit)"
    users ||--o{ bookings : "maid works (maid_id, implicit)"
    users ||--o{ reviews : "maid rated (maid_id, implicit)"
    users ||--o{ reviews : "household writes (household_id, implicit)"
    users ||--o{ messages : "sends (sender_id, implicit)"
    users ||--o{ maid_leaves : "takes (maid_id, FK)"
    users ||--o{ contract_uploads : "uploads (uploaded_by, FK)"
    users ||--o{ staging_contracts : "household/maid (implicit)"

    society_services ||--o{ bookings : "for (society_service_id, implicit)"
    society_services ||--o{ booking_services : "priced as (society_service_id, implicit)"

    bookings ||--o{ booking_services : "contains (booking_id, implicit)"
    bookings ||--o{ reviews : "reviewed (booking_id, implicit)"
    bookings ||--o{ messages : "chat thread (booking_id, implicit)"
    bookings ||--o| bookings : "replacement of (is_replacement_of, implicit self)"

    contract_uploads ||--o{ staging_contracts : "produces (upload_id, implicit)"
    staging_contracts ||--o| bookings : "materializes into (staging_contract_id, FK)"

    societies {
        text id PK
        text name
        text address
        text code "society join code"
    }

    users {
        text id PK
        text role "SOCIETY_ADMIN | HOUSEHOLD | MAID"
        text society_id "implicit -> societies.id (single society)"
        text preferred_maid_id FK "self -> users.id"
        text_array skills "service ids (maids)"
        boolean auto_accept
        time auto_accept_from
        time auto_accept_to
        text expo_push_token
    }

    services {
        text id PK "global catalogue"
        jsonb name "LocalizedString"
        numeric base_price "hourly rate"
        jsonb pricing_config "usage-based fields"
        boolean hidden_from_society_admin
        boolean hidden_from_household
        boolean hidden_from_maid_skills
        boolean is_auto_provisioned
    }

    society_services {
        text id PK "per-society offering"
        text society_id FK "-> societies.id"
        text service_id FK "-> services.id"
        jsonb name "override (else global)"
        numeric price "override (else base_price)"
        text icon "override (else global)"
        boolean is_active
    }

    bookings {
        text id PK
        text booking_type "ADHOC | CONTRACT"
        text household_id "implicit -> users.id"
        text maid_id "implicit -> users.id"
        text society_service_id "implicit -> society_services.id (single-service)"
        text staging_contract_id FK "-> staging_contracts.id"
        text is_replacement_of "implicit self -> bookings.id"
        text status "REQUESTED|CONFIRMED|IN_PROGRESS|COMPLETED|CANCELLED|TERMINATED"
        numeric price_at_booking "snapshot"
        date work_start_date
        date work_end_date
        timestamptz eff_start_date "SCD validity"
        timestamptz eff_end_date "3499-12-31 = current row"
    }

    booking_services {
        text id PK "multi-service line item"
        text booking_id "implicit -> bookings.id"
        text society_service_id "implicit -> society_services.id"
        numeric price_at_booking "snapshot per service"
        integer sort_order
        jsonb booking_inputs "usage-based answers"
    }

    reviews {
        text id PK
        text booking_id "implicit -> bookings.id"
        text maid_id "implicit -> users.id"
        text household_id "implicit -> users.id"
        integer rating
        text comment
    }

    messages {
        text id PK
        text booking_id "implicit -> bookings.id (chat thread)"
        text sender_id "implicit -> users.id"
        text text
        boolean is_read
    }

    maid_leaves {
        text id PK
        text maid_id FK "-> users.id"
        date leave_date
        text leave_type "FULL | MORNING | AFTERNOON"
    }

    contract_uploads {
        text id PK "bulk CSV import batch"
        text uploaded_by FK "-> users.id"
        text_array society_ids
        text status
        jsonb errors
    }

    staging_contracts {
        text id PK "parsed CSV row -> pending contract"
        text upload_id "implicit -> contract_uploads.id"
        text upload_user FK "-> users.id"
        text household_id "implicit -> users.id"
        text maid_id "implicit -> users.id"
        text society_id "implicit -> societies.id"
        text status
    }
```

## Key design notes

- **One `users` table for all roles**, discriminated by `role` (`SOCIETY_ADMIN`, `HOUSEHOLD`, `MAID`).
  Society membership is a single `society_id` — a user belongs to exactly one society.
- **Global catalogue vs per-society:** `services` is the global template; `society_services` is a
  society's activation of a service with optional overrides (price/name/icon/description). Effective value =
  override when present, else the global value. When `services.hidden_from_society_admin` is true, the
  override is ignored and the global catalogue value is used.
- **Bookings** are `ADHOC` or `CONTRACT` (`booking_type`). A booking carries a single legacy
  `society_service_id` **and** one-or-more `booking_services` rows (multi-service). Prices are **snapshotted**
  into `price_at_booking` at creation, so later catalogue/override changes don't alter past bookings.
- **SCD-style history:** `bookings.eff_start_date` / `eff_end_date` version a booking; the current row has
  `eff_end_date = '3499-12-31'`. Most queries filter on that sentinel.
- **Bulk contract pipeline:** `contract_uploads` (one CSV batch) → many `staging_contracts` (parsed rows) →
  each materializes into a `bookings` row (`staging_contract_id`).
- **Referential integrity is mostly app-enforced.** Only `society_services`, `maid_leaves`,
  `contract_uploads`, `staging_contracts.upload_user`, `bookings.staging_contract_id`, and
  `users.preferred_maid_id` have real FK constraints. Core links like `bookings.maid_id → users.id` are
  **not** DB-enforced — worth knowing if you ever clean up orphaned rows.
