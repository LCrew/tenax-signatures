import { Download } from 'lucide-react';
import { download } from '../lib/api';
import { useToast } from '../lib/hooks';
import { t, tx } from '../lib/i18n';
import type { Settings } from '../lib/types';

export function AddinSteps({ settings }: { settings: Settings }) {
  const toast = useToast();
  return (
    <div className="stack loose">
      <ol className="instructions">
        <li>
          <div className="stack tight">
            <span>
              {tx('Make sure {url} reaches this container over HTTPS. Outlook only loads add-ins from trusted TLS hosts.', { url: <strong>{settings.publicUrl}</strong> })}
            </span>
          </div>
        </li>
        <li>
          <div className="stack tight">
            <span>{t("Download the manifest. It already contains this server's address and your app ID.")}</span>
            <button
              type="button"
              className="btn primary"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => download('/api/admin/addin/manifest.xml', 'tenax-signature-manifest.xml').catch((e) => toast(e.message, 'error'))}
            >
              <Download size={14} /> {t('Download manifest.xml')}
            </button>
          </div>
        </li>
        <li>
          <span>
            {tx('In the {center}, go to Settings › Integrated apps › Upload custom apps, and choose "Office Add-in" › "Upload manifest file (.xml) from device".', { center: <strong>Microsoft 365 admin center</strong> })}
          </span>
        </li>
        <li>
          <span>
            {tx('Assign it to {users} and pick {group}. Leave the deployment as "Fixed". Do not assign it to the entire organisation yet.', {
              users: <strong>specific users/groups</strong>,
              group: <strong>{settings.pilotGroupName || t('the pilot group')}</strong>,
            })}
          </span>
        </li>
        <li>
          <span>
            {t('Wait. Microsoft can take up to 24 hours to push the add-in to Outlook clients. Then work through docs/pilot-checklist.md with a pilot mailbox.')}
          </span>
        </li>
        <li>
          <span>
            {t('When the pilot passes, edit the deployment in the admin center and change the assignment to the entire organisation.')}
          </span>
        </li>
      </ol>
      <p className="xs muted">
        {t('Scripted alternative: scripts/deploy-addin.ps1 does the same with the O365CentralizedAddInDeployment module.')}
      </p>
    </div>
  );
}
