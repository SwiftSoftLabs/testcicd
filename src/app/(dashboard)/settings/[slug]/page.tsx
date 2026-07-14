import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import AccountSettings from '@/components/settings/AccountSettings';
import ProfileSettings from '@/components/settings/ProfileSettings';
import UserManagementSettings from '@/components/settings/UserManagementSettings';
import RolesSettings from '@/components/settings/RolesSettings';
import PermissionsSettings from '@/components/settings/PermissionsSettings';
import GitSSHSettings from '@/components/settings/GitSSHSettings';
import WorkspaceSettings from '@/components/settings/WorkspaceSettings';
import NotificationSettings from '@/components/settings/NotificationSettings';
import PluginsSettings from '@/components/settings/PluginsSettings';
import BillingSettings from '@/components/settings/BillingSettings';
import ActivityLogsSettings from '@/components/settings/ActivityLogsSettings';
import SecuritySettings from '@/components/settings/SecuritySettings';

export default async function SettingsSectionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  switch (slug) {
    case 'account':
      return <AccountSettings />;
    case 'profile':
      return <ProfileSettings />;
    case 'users':
      return <UserManagementSettings />;
    case 'roles':
      return <RolesSettings />;
    case 'permissions':
      return <PermissionsSettings />;
    case 'git-ssh':
      return <GitSSHSettings />;
    case 'workspace':
      return (
        <Suspense fallback={null}>
          <WorkspaceSettings />
        </Suspense>
      );
    case 'notifications':
      return <NotificationSettings />;
    case 'plugins':
      return (
        <Suspense fallback={null}>
          <PluginsSettings />
        </Suspense>
      );
    case 'integrations':
      redirect('/settings/plugins');
    case 'billing':
      return <BillingSettings />;
    case 'activity-logs':
      return <ActivityLogsSettings />;
    case 'security':
      return <SecuritySettings />;
    default:
      return notFound();
  }
}
