import { Hono } from 'hono'
import type { AppEnv } from '../types'

const preregistrations = new Hono<AppEnv>()

type PreregistrationPayload = {
  fullName?: string
  phone?: string
  email?: string
  acceptedPrivacyPolicy?: boolean
}

function normalizedText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function emailIsValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

preregistrations.post('/', async (context) => {
  const payload = await context.req
    .json<PreregistrationPayload>()
    .catch(() => null)

  const fullName = normalizedText(payload?.fullName)
  const phone = normalizedText(payload?.phone)
  const email = normalizedText(payload?.email).toLowerCase()
  const acceptedPrivacyPolicy = payload?.acceptedPrivacyPolicy === true

  if (fullName.length < 2) {
    return context.json({ ok: false, error: 'Nombre completo invalido' }, 400)
  }

  if (phone.length < 7) {
    return context.json({ ok: false, error: 'Telefono invalido' }, 400)
  }

  if (!emailIsValid(email)) {
    return context.json({ ok: false, error: 'Correo invalido' }, 400)
  }

  if (!acceptedPrivacyPolicy) {
    return context.json({ ok: false, error: 'Debes aceptar la politica de privacidad' }, 400)
  }

  const supabaseUrl = context.env.SUPABASE_URL?.replace(/\/$/, '')
  const supabaseKey = context.env.SUPABASE_SERVICE_ROLE_KEY
  const appsScriptUrl = context.env.APPS_SCRIPT_URL

  if (!supabaseUrl || !supabaseKey || !appsScriptUrl) {
    console.error('Preregistration services are not configured')
    return context.json({ ok: false, error: 'Registration service unavailable' }, 503)
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/preregistrations`, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      full_name: fullName,
      phone,
      email,
      accepted_privacy_policy: acceptedPrivacyPolicy,
      source: 'web',
    }),
  })

  if (response.status === 409) {
    return context.json({
      ok: false,
      error: 'Este correo ya esta registrado',
    }, 409)
  }

  if (!response.ok) {
    console.error('Supabase preregistration failed', response.status, await response.text())
    return context.json({ ok: false, error: 'Registration service unavailable' }, 502)
  }

  const appsScriptResponse = await fetch(appsScriptUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body: new URLSearchParams({
      fullName,
      phone,
      email,
      acceptedPrivacyPolicy: String(acceptedPrivacyPolicy),
    }).toString(),
  })

  if (!appsScriptResponse.ok) {
    console.error('Apps Script preregistration failed', appsScriptResponse.status)
    return context.json({
      ok: false,
      error: 'El registro fue guardado, pero no se pudo enviar el correo',
    }, 502)
  }

  return context.json({
    ok: true,
    message: 'Registro recibido correctamente',
  }, 201)
})

export default preregistrations
