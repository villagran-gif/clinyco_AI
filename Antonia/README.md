Ejecuta el runner operativo asi:

```bash
cd /Users/box3/Documents/codex
MEDINET_RUT="13580388k" \
MEDINET_QUERY="nelson" \
MEDINET_PATIENT_PHONE="+56987297033" \
MEDINET_PATIENT_MESSAGE="quiero cirugia bariatrica" \
node Antonia/medinet-antonia.cjs
```

Variables opcionales:

- `MEDINET_BRANCH_NAME`
- `MEDINET_HEADED=false`

Salida:

- `MATCHED_PROFESSIONAL`
- `ANTONIA_RESPONSE`
