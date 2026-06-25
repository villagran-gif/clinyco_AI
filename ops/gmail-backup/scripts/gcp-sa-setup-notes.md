# Habilitar Domain-Wide Delegation para el Service Account

El Service Account en GOOGLE_SERVICE_ACCOUNT_EMAIL probablemente fue creado para Google Sheets. Para que GYB pueda leer buzones Gmail necesitas:

## 1) En Google Cloud Console (proyecto del SA)

- Habilitar Gmail API: APIs & Services, Library, Gmail API, Enable
- En el SA (IAM & Admin, Service Accounts):
  - Tab Details, Show Advanced Settings, anota el Client ID numerico (unique id)
  - Marca "Enable Google Workspace Domain-wide Delegation" si no esta

## 2) En Google Workspace Admin (admin.google.com, super admin)

- Ir a: Security, Access and data control, API controls, Manage Domain Wide Delegation
- Add new con:
  - Client ID: el unique id del paso 1
  - OAuth scopes (una sola linea, separadas por coma):
    https://www.googleapis.com/auth/gmail.readonly,https://mail.google.com/
  - gmail.readonly basta para backup; https://mail.google.com/ se agrega si quieres restore completo
- Authorize

## 3) Validacion local (antes de provisionar la VM)

Desde cualquier maquina con el SA json disponible, corre este Python:

    import json, os
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    sa_info = {
      "type": "service_account",
      "client_email": os.environ["GOOGLE_SERVICE_ACCOUNT_EMAIL"],
      "private_key": os.environ["GOOGLE_PRIVATE_KEY"].replace("\\n","\n"),
      "token_uri": "https://oauth2.googleapis.com/token",
    }
    creds = service_account.Credentials.from_service_account_info(
      sa_info, scopes=["https://www.googleapis.com/auth/gmail.readonly"]
    ).with_subject("villagran@clinyco.cl")

    svc = build("gmail", "v1", credentials=creds, cache_discovery=False)
    prof = svc.users().getProfile(userId="me").execute()
    print("OK, messagesTotal:", prof["messagesTotal"])

Resultados esperados:

- Si imprime "messagesTotal: N", DWD listo.
- Si devuelve unauthorized_client, el scope o client id no esta autorizado (revisa paso 2).
- Si devuelve Precondition check failed, el SA no tiene DWD habilitada (revisa paso 1).

## 4) GYB invocacion

gyb-backup.sh ya usa el patron correcto:

    /opt/gyb/gyb.py --email villagran@clinyco.cl \
      --service-account /etc/gyb/sa.json \
      --action backup \
      --search "after:2020/01/01 before:2021/01/01" \
      --local-folder /data/gyb/villagran/2020

GYB internamente hace with_subject(email); no hay que pasar el admin.
