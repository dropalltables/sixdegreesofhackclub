import { SLACK_WORKSPACE_URL } from './config.js';

let workspace = null;

/**
 * Resolve which workspace this token is installed on.
 *
 * The archive URL differs per deployment, so it can't be hardcoded:
 *   standalone workspace       https://acme.slack.com
 *   Enterprise Grid workspace  https://acme.enterprise.slack.com
 *
 * auth.test returns the correct one for either case and needs no scopes.
 */
export async function resolveWorkspace(webClient) {
  const auth = await webClient.auth.test();

  const baseUrl = (SLACK_WORKSPACE_URL || auth.url || '').replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('Could not determine workspace URL from auth.test - set SLACK_WORKSPACE_URL in .env');
  }

  workspace = {
    name: auth.team || auth.team_id || 'Unknown workspace',
    teamId: auth.team_id || null,
    enterpriseId: auth.enterprise_id || null,
    isEnterpriseInstall: auth.is_enterprise_install === true,
    baseUrl
  };

  console.log(`[INFO] Workspace: ${workspace.name} (${workspace.teamId})`);
  console.log(`[INFO] Message links will use ${workspace.baseUrl}`);

  if (workspace.enterpriseId) {
    console.log(`[INFO] Workspace is part of Enterprise Grid org ${workspace.enterpriseId}`);
  }

  // An org-wide install scopes the token to every workspace at once, which
  // changes how conversations.list behaves (it needs an explicit team_id).
  // This bot scans one workspace, so flag it rather than silently mixing orgs.
  if (workspace.isEnterpriseInstall) {
    console.warn('[WARN] This token comes from an org-wide install, not a single-workspace install.');
    console.warn('[WARN] Channel listing may span the org or fail. Reinstall the app to one workspace');
    console.warn('[WARN] (keep org_deploy_enabled: false in the manifest) for expected results.');
  }

  return workspace;
}

export function getWorkspace() {
  if (!workspace) {
    throw new Error('resolveWorkspace() must be called before the workspace is used');
  }
  return workspace;
}

export function getWorkspaceName() {
  return workspace ? workspace.name : 'Unknown workspace';
}

/**
 * Build a permalink to a message
 */
export function getMessageLink(channelId, ts) {
  return `${getWorkspace().baseUrl}/archives/${channelId}/p${ts.replace('.', '')}`;
}
