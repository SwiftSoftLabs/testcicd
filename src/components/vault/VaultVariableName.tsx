import { formatVaultVariableName } from '@/lib/vault/variable-names';

interface Props {
    name: string;
    className?: string;
}

const NAME_COLUMN_CLASS =
    'block shrink-0 min-w-0 w-40 sm:w-64 lg:w-72';

/** Consistent monospace, uppercase label for vault variable names. */
export default function VaultVariableName({ name, className = '' }: Props) {
    const formatted = formatVaultVariableName(name);
    return (
        <span
            title={formatted}
            aria-label={formatted}
            className={`font-mono text-xs uppercase tracking-wide text-text-primary truncate ${NAME_COLUMN_CLASS} ${className}`.trim()}
        >
            {formatted}
        </span>
    );
}
