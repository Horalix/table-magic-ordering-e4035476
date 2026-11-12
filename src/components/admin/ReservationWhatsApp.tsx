import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, CircleDashed, Loader2, MessageCircle, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const untyped = supabase as unknown as { from: (table: string) => any };

/** The restaurant's two choices (20261114090000_reservation_messages.sql). */
interface Choices { id: number; reservations_whatsapp_guest: boolean; reservations_whatsapp_admin: string | null }

/** Where the set-up stands, as the reservation-messages function reports it. */
interface Report {
  configured: boolean;
  number: boolean;
  ready: boolean;
  templates: { name: string; language: string; status: string }[];
  error?: string;
  refused?: { name: string; language: string; error: string }[];
}

const call = async (body: Record<string, unknown>): Promise<{ data: Report & { sent?: boolean } | null; error: string | null }> => {
  const { data, error } = await supabase.functions.invoke('reservation-messages', { body });
  if (!error) return { data: data as Report, error: null };
  // The function's own words, where it answered with some.
  let said: string | null = null;
  try { said = ((await (error as { context?: Response }).context?.json()) as { error?: string } | undefined)?.error ?? null; } catch { /* no body */ }
  return { data: null, error: said ?? error.message };
};

const looksLikePhone = (raw: string) => { const digits = raw.replace(/\D/g, ''); return digits.length >= 8 && digits.length <= 15; };

/**
 * WhatsApp messages about reservations, on Admin → Reservations: whether the
 * restaurant's WhatsApp Business number is connected and its messages
 * approved, and the restaurant's two choices: message guests (when their
 * request arrives and when it is answered), and a number to be told about
 * new requests. Not drawn before the database knows the two choices.
 */
const ReservationWhatsApp = ({ venueSlug }: { venueSlug: string }) => {
  const [choices, setChoices] = useState<Choices | null | undefined>(undefined);
  const [report, setReport] = useState<Report | null | undefined>(undefined);
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState<'setup' | 'test' | 'save' | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await untyped.from('restaurant_settings')
      .select('id, reservations_whatsapp_guest, reservations_whatsapp_admin').maybeSingle();
    const row = !error && data && typeof data.reservations_whatsapp_guest === 'boolean' ? (data as Choices) : null;
    setChoices(row);
    setNumber(row?.reservations_whatsapp_admin ?? '');
    if (!row) return;
    const status = await call({ action: 'status', venue: venueSlug });
    setReport(status.data);
  }, [venueSlug]);
  useEffect(() => { void load(); }, [load]);

  if (!choices) return null;

  const save = async (patch: Partial<Choices>, done: string) => {
    setBusy('save');
    const { error } = await untyped.from('restaurant_settings').update(patch).eq('id', choices.id);
    setBusy(null);
    if (error) { toast.error(/whatsapp_admin_check/.test(error.message) ? 'That does not look like a phone number.' : error.message); return; }
    setChoices({ ...choices, ...patch });
    toast.success(done);
  };

  const setUp = async () => {
    setBusy('setup');
    const made = await call({ action: 'setup', venue: venueSlug });
    setBusy(null);
    if (!made.data) { toast.error(made.error === 'not_configured' ? 'WhatsApp is not connected yet.' : made.error ?? 'Could not reach WhatsApp'); return; }
    setReport(made.data);
    if (made.data.refused?.length) toast.error(`WhatsApp refused ${made.data.refused.length}: ${made.data.refused[0].error}`);
    else toast.success('Sent to WhatsApp for approval. This usually takes a few minutes.');
  };

  const test = async () => {
    setBusy('test');
    const sent = await call({ action: 'test', venue: venueSlug, to: number });
    setBusy(null);
    if (sent.data?.sent) toast.success('Sent. It should arrive on WhatsApp within seconds.');
    else toast.error(sent.error ?? 'Could not send');
  };

  const approved = report?.templates.filter((t) => t.status === 'APPROVED').length ?? 0;
  const missing = report?.templates.filter((t) => t.status === 'MISSING').length ?? 0;
  const rejected = report?.templates.filter((t) => !['APPROVED', 'MISSING', 'PENDING', 'IN_APPEAL'].includes(t.status)) ?? [];
  const ready = report?.ready === true;
  const numberChanged = number.trim() !== (choices.reservations_whatsapp_admin ?? '');

  const state = report === undefined ? { tone: 'text-muted-foreground', Icon: Loader2, text: 'Checking…' }
    : !report?.configured ? { tone: 'text-muted-foreground', Icon: CircleDashed, text: 'Not connected yet' }
    : !report.number ? { tone: 'text-amber-600', Icon: TriangleAlert, text: 'No number for this restaurant yet' }
    : ready ? { tone: 'text-primary', Icon: CheckCircle2, text: 'Ready' }
    : { tone: 'text-amber-600', Icon: CircleDashed, text: `${approved} of ${report.templates.length} messages approved` };

  return (
    <div data-testid="reservation-whatsapp" className="rounded-xl border border-border/60 px-4 py-3 font-sans space-y-3">
      <div className="flex items-center gap-3">
        <MessageCircle className="w-5 h-5 shrink-0 text-primary" aria-hidden />
        <p className="flex-1 min-w-0 text-sm font-semibold text-foreground">WhatsApp messages</p>
        <span data-testid="whatsapp-state" className={`inline-flex items-center gap-1.5 text-xs font-medium ${state.tone}`}>
          <state.Icon className={`w-3.5 h-3.5 ${report === undefined ? 'animate-spin' : ''}`} aria-hidden /> {state.text}
        </span>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Sent by themselves from your restaurant&rsquo;s own WhatsApp Business number: the guest is told when their request arrives and when you
        answer, in the language they asked in.
        {report && !report.configured && ' It needs that number connected once; until then nothing is sent, and “Tell the guest” above works as it does now.'}
        {report?.configured && !report.number && ' This restaurant has no number of its own connected yet.'}
        {report?.error && ` WhatsApp could not be asked just now: ${report.error}`}
      </p>

      {report?.configured && report.number && !ready && (
        <div className="rounded-lg bg-muted/40 px-3 py-2 space-y-2">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {missing > 0
              ? 'WhatsApp approves the wording of each message before it can be sent. Send them for approval once:'
              : 'WhatsApp is reviewing the messages. This usually takes a few minutes; come back to this page.'}
            {rejected.length > 0 && ` Not approved: ${rejected.map((t) => `${t.name} (${t.language})`).join(', ')}.`}
          </p>
          {missing > 0 && (
            <Button type="button" size="sm" onClick={() => void setUp()} disabled={busy !== null} className="gap-2">
              {busy === 'setup' && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Set up the messages
            </Button>
          )}
        </div>
      )}

      <div className="flex items-start gap-4">
        <Switch id="whatsapp-guest" checked={choices.reservations_whatsapp_guest} disabled={busy !== null || (!ready && !choices.reservations_whatsapp_guest)}
          onCheckedChange={(on) => void save({ reservations_whatsapp_guest: on }, on ? 'Guests will be messaged on WhatsApp' : 'Guests are no longer messaged')} />
        <Label htmlFor="whatsapp-guest" className="text-sm font-semibold">
          Message guests on WhatsApp
          <span className="block text-xs font-normal text-muted-foreground">
            {choices.reservations_whatsapp_guest
              ? 'On: “we have your request”, then “confirmed”, “declined” or “cancelled”.'
              : ready ? 'Off: nothing is sent to guests.' : 'Can be turned on once the messages are approved.'}
          </span>
        </Label>
      </div>

      <div>
        <Label htmlFor="whatsapp-admin" className="text-xs">Also tell this WhatsApp number about new requests (optional)</Label>
        <div className="mt-1 flex flex-wrap gap-2">
          <Input id="whatsapp-admin" type="tel" inputMode="tel" value={number} maxLength={25} placeholder="+387 6…"
            onChange={(e) => setNumber(e.target.value)} className="h-11 flex-1 min-w-[180px]" />
          <Button type="button" variant="outline" disabled={!numberChanged || busy !== null || (number.trim() !== '' && !looksLikePhone(number))}
            onClick={() => void save({ reservations_whatsapp_admin: number.trim() || null }, number.trim() ? 'This number will be told about new requests' : 'No number is told any more')}
            className="h-11">
            Save
          </Button>
          <Button type="button" variant="outline" disabled={!ready || !looksLikePhone(number) || busy !== null} onClick={() => void test()} className="h-11 gap-2">
            {busy === 'test' && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Send a test
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          A WhatsApp message rings an iPhone like any other, with no app to add. It also tells this number when a guest gives back a confirmed table.
        </p>
      </div>
    </div>
  );
};

export default ReservationWhatsApp;
