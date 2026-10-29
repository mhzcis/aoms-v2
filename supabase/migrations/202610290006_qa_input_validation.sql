begin;

-- Keep existing operational data intact; validate phone edits and new operators.
-- This is validation only: no grants, role changes, or authentication changes.
create or replace function public.validate_operator_phone()
returns trigger language plpgsql set search_path = public as $$
declare compact text;
begin
  -- The existing admin-only SECURITY DEFINER restore preserves historical
  -- values byte-for-byte. A regular authenticated/anonymous statement cannot
  -- obtain this exception merely by changing a session setting.
  if current_setting('aoms.in_restore', true) = 'true'
     and current_user not in ('authenticated', 'anon') and public.is_admin() then return new; end if;
  if tg_op = 'UPDATE' and new.phone is not distinct from old.phone then return new; end if;
  new.phone := trim(translate(coalesce(new.phone, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'));
  compact := regexp_replace(new.phone, '[[:space:]().-]', '', 'g');
  if new.phone <> '' and (new.phone !~ '^\+?[0-9[:space:]().-]+$' or compact !~ '^\+?[0-9]{7,15}$') then
    raise exception 'أدخل رقم هاتف من 7 إلى 15 رقمًا أو اتركه فارغًا';
  end if;
  return new;
end $$;

drop trigger if exists validate_operator_phone on public.operators;
create trigger validate_operator_phone before insert or update of phone on public.operators
for each row execute function public.validate_operator_phone();

-- Reassert the business day after earlier CREATE OR REPLACE RPC migrations.
alter function public.save_operation_log(jsonb, jsonb) set timezone = 'Asia/Jerusalem';
alter function public.save_fuel_transaction(jsonb) set timezone = 'Asia/Jerusalem';
alter function public.save_chlorine_transaction(jsonb) set timezone = 'Asia/Jerusalem';

commit;
