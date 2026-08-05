import { useState } from 'react';
import type { AuditLogRecord, User } from '@medsupply/shared-types';
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Pagination,
  Resource,
  Select,
} from '../components/ui';
import { useApiCollection } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';
import { formatFinanceDateTime } from '../lib/finance';
import { humaniseEnum } from '@medsupply/utilities';

const PAGE_SIZE = 25;

interface AuditRow extends Omit<AuditLogRecord, 'actorId'> {
  actorId: (Partial<User> & { _id: string }) | string;
}

function actorLabel(actor: AuditRow['actorId'], unknown: string) {
  if (!actor) return unknown;
  if (typeof actor === 'string') return actor;
  const name = [actor.firstName, actor.lastName].filter(Boolean).join(' ').trim();
  return name || actor.email || String(actor._id);
}

/** Shows only what the record itself contains; nothing is inferred or re-derived. */
function summarise(row: AuditRow, none: string) {
  const changed = row.after && typeof row.after === 'object' ? Object.keys(row.after) : [];
  return changed.length ? changed.slice(0, 6).join(', ') : none;
}

export function AuditLogViewer() {
  const { t } = useLanguage();
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const actions = useApiCollection<string>(['audit-actions'], '/admin/audit/actions');

  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (action) params.set('action', action);
  if (entityType) params.set('entityType', entityType);
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const entries = useApiCollection<AuditRow>(
    ['audit', action, entityType, from, to, page],
    `/admin/audit?${params.toString()}`,
  );

  const reset = () => setPage(1);

  return (
    <>
      <PageHeader
        routeId="audit"
        title={t('audit.title')}
        description={t('audit.subtitle')}
        actions={<Button onClick={() => void entries.refetch()}>{t('audit.reload')}</Button>}
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label={t('audit.action')} className="min-w-56">
          <Select
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              reset();
            }}
          >
            <option value="">{t('audit.allActions')}</option>
            {(actions.data?.items ?? []).map((value) => (
              <option key={value} value={value}>
                {humaniseEnum(value)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('audit.entityType')} className="min-w-48">
          <Input
            value={entityType}
            placeholder={t('audit.entityHint')}
            onChange={(event) => {
              setEntityType(event.target.value);
              reset();
            }}
          />
        </Field>
        <Field label={t('finance.from')} className="min-w-40">
          <Input
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              reset();
            }}
          />
        </Field>
        <Field label={t('finance.to')} className="min-w-40">
          <Input
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              reset();
            }}
          />
        </Field>
      </div>

      <Resource
        query={entries}
        loadingLabel={t('audit.loading')}
        errorMessageFallback={t('audit.couldNotLoad')}
        empty={<EmptyState title={t('audit.none')} description={t('audit.noneBody')} />}
      >
        {(result) => (
          <>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {result.items.map((row) => (
                <li key={row._id}>
                  <Card className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-64 flex-1">
                      <p className="font-medium text-text">{humaniseEnum(row.action)}</p>
                      <p className="text-text-muted">
                        {row.entityType} · {String(row.entityId)}
                      </p>
                      <p className="text-sm text-text-muted">
                        {actorLabel(row.actorId, t('audit.unknownActor'))}
                        {row.actorRole ? ` (${t(`roles.${row.actorRole}`)})` : ''} ·{' '}
                        {formatFinanceDateTime(row.createdAt)}
                        {row.ipAddress ? ` · ${row.ipAddress}` : ''}
                      </p>
                      <p className="text-sm text-text-muted">
                        {summarise(row, t('audit.noDetail'))}
                      </p>
                      {expanded === row._id && (
                        <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-surface-sunken p-3 text-sm text-text">
                          {JSON.stringify({ before: row.before, after: row.after }, null, 2)}
                        </pre>
                      )}
                    </div>
                    <Button
                      size="sm"
                      aria-expanded={expanded === row._id}
                      onClick={() => setExpanded(expanded === row._id ? null : row._id)}
                    >
                      {expanded === row._id ? t('audit.hideDetail') : t('audit.showDetail')}
                    </Button>
                  </Card>
                </li>
              ))}
            </ul>
            <Pagination
              page={result.page}
              limit={result.limit}
              total={result.total}
              onPage={setPage}
            />
          </>
        )}
      </Resource>
    </>
  );
}
