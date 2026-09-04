<?php

/**
 * Renders config/local.php from environment variables on every container
 * boot (web, cron and worker alike), so the three roles always share the
 * exact same configuration without relying on a shared writable volume.
 */

function requireEnv(string $name): string
{
    $value = getenv($name);
    if (false === $value || '' === $value) {
        fwrite(STDERR, "Missing required environment variable: {$name}\n");
        exit(1);
    }

    return $value;
}

function envBool(string $name, bool $default): bool
{
    $value = getenv($name);
    if (false === $value || '' === $value) {
        return $default;
    }

    return filter_var($value, FILTER_VALIDATE_BOOLEAN);
}

function envList(string $name, array $default): array
{
    $value = getenv($name);
    if (false === $value || '' === $value) {
        return $default;
    }

    return array_values(array_filter(array_map('trim', explode(',', $value))));
}

$parameters = [
    'db_driver'             => getenv('MAUTIC_DB_DRIVER') ?: 'pdo_mysql',
    'db_host'               => requireEnv('MAUTIC_DB_HOST'),
    'db_port'               => (int) (getenv('MAUTIC_DB_PORT') ?: 3306),
    'db_name'               => requireEnv('MAUTIC_DB_NAME'),
    'db_user'               => requireEnv('MAUTIC_DB_USER'),
    'db_password'           => requireEnv('MAUTIC_DB_PASSWORD'),
    'db_table_prefix'       => getenv('MAUTIC_DB_TABLE_PREFIX') ?: null,

    'site_url'              => requireEnv('MAUTIC_SITE_URL'),
    'secret_key'            => requireEnv('MAUTIC_SECRET_KEY'),

    'admin_email'           => getenv('MAUTIC_ADMIN_EMAIL') ?: null,
    'admin_password'        => getenv('MAUTIC_ADMIN_PASSWORD') ?: null,

    'mailer_from_name'      => getenv('MAUTIC_MAILER_FROM_NAME') ?: 'Mautic',
    'mailer_from_email'     => getenv('MAUTIC_MAILER_FROM_EMAIL') ?: null,

    'api_enabled'           => envBool('MAUTIC_API_ENABLED', true),
    'api_enable_basic_auth' => envBool('MAUTIC_API_ENABLE_BASIC_AUTH', true),

    // EasyPanel terminates TLS at Traefik and proxies over the internal
    // network, so trust whichever host makes the direct connection.
    'trusted_proxies'       => envList('MAUTIC_TRUSTED_PROXIES', ['REMOTE_ADDR']),
    'trusted_hosts'         => envList('MAUTIC_TRUSTED_HOSTS', []),
];

$parameters = array_filter($parameters, static fn ($value) => null !== $value);

$exported = var_export($parameters, true);
$contents = "<?php\n\n\$parameters = {$exported};\n";

file_put_contents(__DIR__.'/../config/local.php', $contents);

fwrite(STDOUT, "config/local.php generated from environment variables.\n");
