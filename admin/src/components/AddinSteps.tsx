import { Download } from 'lucide-react';
import { download } from '../lib/api';
import { useToast } from '../lib/hooks';
import type { Settings } from '../lib/types';

export function AddinSteps({ settings }: { settings: Settings }) {
  const toast = useToast();
  return (
    <div className="stack loose">
      <ol className="instructions">
        <li>
          <div className="stack tight">
            <span>
              Make sure <strong>{settings.publicUrl}</strong> reaches this container over HTTPS. Outlook only loads add-ins
              from trusted TLS hosts.
            </span>
          </div>
        </li>
        <li>
          <div className="stack tight">
            <span>Download the manifest. It already contains this server's address and your app ID.</span>
            <button
              type="button"
              className="btn primary"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => download('/api/admin/addin/manifest.xml', 'tenax-signature-manifest.xml').catch((e) => toast(e.message, 'error'))}
            >
              <Download size={14} /> Download manifest.xml
            </button>
          </div>
        </li>
        <li>
          <span>
            In the <strong>Microsoft 365 admin center</strong>, go to Settings › Integrated apps › Upload custom apps, and choose
            "Office Add-in" › "Upload manifest file (.xml) from device".
          </span>
        </li>
        <li>
          <span>
            Assign it to <strong>specific users/groups</strong> and pick <strong>{settings.pilotGroupName || 'the pilot group'}</strong>.
            Leave the deployment as "Fixed". Do not assign it to the entire organisation yet.
          </span>
        </li>
        <li>
          <span>
            Wait. Microsoft can take up to 24 hours to push the add-in to Outlook clients. Then work through
            docs/pilot-checklist.md with a pilot mailbox.
          </span>
        </li>
        <li>
          <span>
            When the pilot passes, edit the deployment in the admin center and change the assignment to the entire
            organisation.
          </span>
        </li>
      </ol>
      <p className="xs muted">
        Scripted alternative: scripts/deploy-addin.ps1 does the same with the O365CentralizedAddInDeployment module.
      </p>
    </div>
  );
}
