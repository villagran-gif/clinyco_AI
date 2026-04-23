# GYB a Hetzner StorageBox backup kit

Respaldo completo de Gmail (bandeja y Drafts/Sent/Labels/adjuntos) a StorageBox Hetzner, usando GYB en una VM Hetzner Cloud efimera.

## Resumen de decisiones

- VM: cpx22 (2c AMD / 4GB / 80GB) en nbg1
- Imagen: ubuntu-24.04
- Auth Gmail: Service Account + Domain-Wide Delegation (usa GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY ya en env). Si DWD no esta habilitada, ver scripts/gcp-sa-setup-notes.md
- Auth StorageBox: Keypair ed25519 generada en la VM. La publica se imprime en /var/log/cloud-init-output.log para registrarla UNA VEZ en el panel StorageBox
- Estrategia: GYB escribe a disco local, rclone SFTP empuja al StorageBox, borra local, siguiente chunk
- Chunk: Por ano. Si un ano supera 60 GB, subdividir por mes (variable CHUNK_GRANULARITY=month)
- Lifecycle: Mantener VM running encadenando villagran a Carolin. DELETE final al terminar todo
- Logs: journalctl -u gyb-backup@ACCOUNT

## Prerequisitos

1. HETZNER_TOKEN valido en env.
2. HETZNER_SSH (publica) ya registrada como SSH key id 111054138 en el proyecto Hetzner.
3. Acceso al panel StorageBox (robot.hetzner.com, Storage Boxes) para pegar la publica que generara la VM.
4. Acceso a Google Workspace Admin para habilitar DWD del Service Account.
5. Llave privada correspondiente a HETZNER_SSH en tu laptop.

## Orden de operaciones

1. Crear la VM:   ./provision.sh villagran
2. Esperar cloud-init:   ssh root@IP cloud-init status --wait
3. Extraer pub StorageBox:   ssh root@IP grep -A1 STORAGEBOX_PUBKEY_BEGIN /var/log/cloud-init-output.log
4. Pegar esa pub en robot.hetzner.com, Storage Box, SSH keys
5. Verificar:   ssh root@IP rclone lsd storagebox:
6. Lanzar backup:   ssh root@IP systemctl start gyb-backup@villagran.service
7. Monitorear:   ssh root@IP journalctl -u gyb-backup@villagran -f
8. Repetir pasos 6-7 para carolin
9. Cuando todo verificado:   ./teardown.sh gyb-backup-villagran

## Archivos del kit

- provision.sh: Crea la VM via Hetzner API
- teardown.sh: Borra la VM (rechaza nombres que no sean gyb-backup-*)
- cloud-init.yaml: User-data, instala GYB + rclone, genera keypair StorageBox
- scripts/first-boot.sh: Bootstrap de la VM en primer arranque
- scripts/gyb-backup.sh: Loop de chunks por ano con rclone push y verificacion
- scripts/gcp-sa-setup-notes.md: Pasos para autorizar DWD

## Costos

Proyecto completo (2-3 dias) menor a 1 EUR. Apagar la VM NO reduce costo; solo DELETE lo hace.
