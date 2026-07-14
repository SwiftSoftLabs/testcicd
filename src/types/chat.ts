export type Conversation = {
    id: string;
    name: string;
    type: 'channel' | 'dm';
    unreadCount: number;
    quota_locked?: boolean;
    description?: string;
    dmOtherId?: string;
    dmOtherName?: string;
    dmOtherAvatar?: string;
};
