/**
 * The card form's gateway, simulated (demo mode only).
 *
 * In production the guest types a card into fields hosted by Monri, loaded
 * from Monri's own script (src/components/guest/MonriCardForm.tsx). That
 * script cannot load offline, and a demo must never take a real card. This
 * puts an object with the same few methods where the script would put its
 * own: the form shows a card already filled in, and "Pay" tells the demo
 * backend the gateway approved it — which then goes through the same
 * database function a real approval does (backend/functions.ts).
 *
 * Nothing leaves the browser and nothing is charged.
 */

interface FakeCard {
  mount(selector: string): void;
  unmount(): void;
}

const SUPABASE_URL = ((import.meta.env.VITE_SUPABASE_URL as string | undefined) || 'https://supabase-not-configured.invalid').replace(/\/$/, '');

const FIELD = 'border:0;background:transparent;font:500 14px/1.4 Inter,system-ui,sans-serif;color:#2b2a26;outline:none;min-width:0;padding:0;';

function cardMarkup(): string {
  return `
    <div data-demo-card>
      <div style="display:flex;align-items:center;gap:8px">
        <svg width="30" height="20" viewBox="0 0 30 20" aria-hidden="true" style="flex:none">
          <rect width="30" height="20" rx="4" fill="#33473B"/><rect x="4" y="6" width="7" height="5" rx="1.2" fill="#E8C98A"/>
          <rect x="4" y="14" width="10" height="2" rx="1" fill="#fff" opacity=".6"/><rect x="17" y="14" width="9" height="2" rx="1" fill="#fff" opacity=".6"/>
        </svg>
        <input aria-label="Card number" inputmode="numeric" value="4242 4242 4242 4242" style="${FIELD}flex:1 1 150px" />
        <input aria-label="Expiry" value="12/29" style="${FIELD}flex:0 0 44px;text-align:center" />
        <input aria-label="CVC" value="123" style="${FIELD}flex:0 0 30px;text-align:center" />
      </div>
    </div>`;
}

export function installFakeCardGateway(): void {
  const factory = () => {
    let secret = '';
    return {
      components({ clientSecret }: { clientSecret: string }) {
        secret = clientSecret;
        return {
          create(): FakeCard {
            let host: Element | null = null;
            return {
              mount(selector: string) {
                host = document.querySelector(selector);
                if (!host) throw new Error('No card element');
                host.innerHTML = cardMarkup();
              },
              unmount() { if (host) host.innerHTML = ''; },
            };
          },
        };
      },
      async confirmPayment() {
        // A card that starts with 4000 is declined, so the failure path can be shown too.
        const number = document.querySelector<HTMLInputElement>('[data-demo-card] input')?.value.replace(/\s/g, '') ?? '';
        const approved = !number.startsWith('4000');
        await new Promise((resolve) => setTimeout(resolve, 1100));
        const response = await fetch(`${SUPABASE_URL}/functions/v1/demo-card-result`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ client_secret: secret, approved }),
        });
        if (!response.ok) return { error: { message: 'The demo card could not be processed.' } };
        return { result: { status: approved ? 'approved' : 'declined', 'response-message': approved ? 'approved' : 'declined' } };
      },
    };
  };
  (window as unknown as { Monri: unknown }).Monri = factory;
}
