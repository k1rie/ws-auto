import readline from 'readline';
import { query } from '../config/database.js';

function hasYesFlag() {
  return process.argv.includes('--yes') || process.argv.includes('-y');
}

async function confirmOrExit() {
  if (hasYesFlag()) return;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (q) => new Promise((resolve) => rl.question(q, resolve));

  const answer = await question(
    'Vas a ELIMINAR TODOS los registros de la tabla "contactos". Escribe "ELIMINAR" para confirmar: '
  );
  rl.close();

  if ((answer || '').trim() !== 'ELIMINAR') {
    console.log('[INFO] Operación cancelada.');
    process.exit(0);
  }
}

async function main() {
  await confirmOrExit();

  // Intentar TRUNCATE (resetea AUTO_INCREMENT). Si falla por FK, hacer DELETE.
  try {
    await query('SET FOREIGN_KEY_CHECKS = 0');
    await query('TRUNCATE TABLE contactos');
    await query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('[INFO] Tabla "contactos" vaciada (TRUNCATE).');
  } catch (error) {
    try {
      await query('SET FOREIGN_KEY_CHECKS = 1');
    } catch (e) {
      // ignore
    }
    console.warn(`[WARN] TRUNCATE falló, intentando DELETE. Motivo: ${error.message}`);
    const result = await query('DELETE FROM contactos');
    console.log(`[INFO] Contactos eliminados (DELETE). Filas afectadas: ${result?.affectedRows ?? 'N/A'}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('[ERROR] Falló el script de limpieza de contactos:', err);
  process.exit(1);
});

