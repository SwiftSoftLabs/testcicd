import { getPluginMessageSource, isPluginSourcedMessage } from '@/lib/plugins/chat/pluginMessage';

import { PluginSourceBadge } from './PluginSourceBadge';

export { isPluginSourcedMessage, getPluginMessageSource };

export function SlackSourceBadge() {
    return <PluginSourceBadge source="slack" />;
}
