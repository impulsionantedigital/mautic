<?php

/**
 * Mautic's own "mautic:install" checks whether it should run by looking at
 * config/local.php (db_driver/site_url present = "installed"). Since our
 * entrypoint regenerates config/local.php from environment variables on
 * every boot, that check is always true and would make mautic:install skip
 * itself forever - including on a genuinely empty, freshly created
 * database. Check the real database schema instead: does the "plugins"
 * table (created by the install's schema step) exist?
 *
 * Prints "yes" or "no" to stdout. Exits non-zero (and prints nothing
 * meaningful) if the database itself isn't reachable yet.
 */

$prefix = getenv('MAUTIC_DB_TABLE_PREFIX') ?: '';
$table  = $prefix.'plugins';

$dsn = sprintf(
    'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
    getenv('MAUTIC_DB_HOST'),
    getenv('MAUTIC_DB_PORT') ?: '3306',
    getenv('MAUTIC_DB_NAME')
);

try {
    $pdo = new PDO($dsn, getenv('MAUTIC_DB_USER'), getenv('MAUTIC_DB_PASSWORD'), [
        PDO::ATTR_TIMEOUT => 5,
    ]);
    $stmt = $pdo->prepare('SHOW TABLES LIKE ?');
    $stmt->execute([$table]);
    echo $stmt->fetchColumn() ? 'yes' : 'no';
} catch (\Throwable $e) {
    fwrite(STDERR, 'Could not check schema: '.$e->getMessage()."\n");
    exit(1);
}
