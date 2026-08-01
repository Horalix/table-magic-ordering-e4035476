create extension if not exists pgcrypto with schema extensions;

do $$
declare v_id uuid;
begin
  select id into v_id from auth.users where email = 'kerim@lasoul.net';

  if v_id is null then
    v_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
      'kerim@lasoul.net',
      extensions.crypt('Kerim123!', extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Kerim"}'::jsonb,
      '', '', '', ''
    );
  else
    update auth.users
       set encrypted_password = extensions.crypt('Kerim123!', extensions.gen_salt('bf')),
           email_confirmed_at  = coalesce(email_confirmed_at, now()),
           updated_at = now()
     where id = v_id;
  end if;

  if not exists (
    select 1 from auth.identities where user_id = v_id and provider = 'email'
  ) then
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_id, v_id::text,
      jsonb_build_object('sub', v_id::text, 'email', 'kerim@lasoul.net',
                         'email_verified', true),
      'email', now(), now(), now()
    );
  end if;

  insert into public.user_roles (user_id, role) values (v_id, 'admin')
  on conflict do nothing;
end $$;