# Tabla principal de DEALS

Contactos abre DEALS en una tabla: cada fila es un deal y el nombre abre su ficha. Los filtros existentes de embudo, sede, responsable y actividad se aplican en servidor a ambas vistas. La paginación mantiene Cargar más DEALS y distingue resultados pendientes. El tablero por etapas sigue disponible como vista alternativa.

Columnas visibles permite seleccionar los campos aprobados, incluidos datos automáticos y enlaces. Nombre del trato permanece fijo. Solo se guardan las preferencias de columnas en el navegador, nunca los datos de pacientes. El encabezado y la primera columna permanecen visibles durante el desplazamiento. Restablecer columnas recupera la selección inicial.

Validación: integración PostgreSQL/PGlite y navegador JSDOM de carga de filas, tabla inicial, selector de columnas, alternancia de vistas y apertura/guardado de ficha desde el nombre. No incorpora importaciones históricas ni modifica API, autenticación o datos existentes.
