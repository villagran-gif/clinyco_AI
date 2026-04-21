-- Telemedicine appointment lifecycle tables.
-- Created for branchId ∈ {2, 3} (Telemedicina Clinyco1 / Clinyco2).
-- Captures appointments booked via our bot (realtime hook) OR via staff /
-- agendaweb / admin panel (polling fetchAllAppointments).

create table if not exists telemedicine_appointments (
  id bigserial primary key,
  medinet_appointment_id bigint not null,
  branch_id integer not null,
  customer_id bigint references customers(id) on delete set null,
  conversation_id text references conversations(conversation_id) on delete set null,
  patient_rut text,
  patient_name text,
  whatsapp_phone text,
  email text,
  professional_id bigint,
  professional_name text,
  professional_phone text,
  specialty text,
  starts_at timestamptz not null,
  duration_minutes integer,
  status text not null default 'booked',
  payment_status text not null default 'none',
  payment_reference text,
  payment_url text,
  payment_amount numeric(10, 2),
  session_url text,
  session_token text,
  source text not null default 'polling',
  raw_medinet_json jsonb,
  last_error text,
  confirmed_at timestamptz,
  payment_confirmed_at timestamptz,
  session_delivered_at timestamptz,
  professional_notified_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists telemedicine_appointments_medinet_unique_idx
  on telemedicine_appointments (medinet_appointment_id);

create index if not exists telemedicine_appointments_status_idx
  on telemedicine_appointments (status);

create index if not exists telemedicine_appointments_payment_status_idx
  on telemedicine_appointments (payment_status)
  where payment_status = 'pending';

create index if not exists telemedicine_appointments_starts_at_idx
  on telemedicine_appointments (starts_at);

-- One row per reminder job. Worker consumes where sent_at IS NULL AND scheduled_for <= now().
create table if not exists telemedicine_reminders (
  id bigserial primary key,
  appointment_id bigint not null references telemedicine_appointments(id) on delete cascade,
  kind text not null,
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);

create unique index if not exists telemedicine_reminders_unique_idx
  on telemedicine_reminders (appointment_id, kind);

create index if not exists telemedicine_reminders_due_idx
  on telemedicine_reminders (scheduled_for)
  where sent_at is null;

-- Observability state for the ingest loop.
create table if not exists telemedicine_ingest_state (
  id integer primary key default 1,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_fetched_count integer,
  last_inserted_count integer,
  last_error text,
  updated_at timestamptz not null default now(),
  constraint telemedicine_ingest_state_singleton check (id = 1)
);

insert into telemedicine_ingest_state (id) values (1) on conflict (id) do nothing;
