export const notificationTemplates = {
  'auth.reset': {
    label: 'Password reset',
    variables: ['company', 'link'],
    subject: 'Reset your {{company}} password',
    body: 'Reset your password: {{link}}\nThis link expires in 30 minutes.',
  },
  'auth.verify': {
    label: 'Email verification',
    variables: ['company', 'link'],
    subject: 'Verify your email for {{company}}',
    body: 'Confirm your email address: {{link}}\nThis link expires in 24 hours. If you did not request this email, ignore it.',
  },
  'auth.login': {
    label: 'Login alert',
    variables: ['company', 'name', 'ip', 'time', 'link'],
    subject: 'New sign-in to {{company}}',
    body: 'Hello {{name}},\nA sign-in to your account occurred at {{time}} from {{ip}}.\nIf this was unexpected, change your password: {{link}}',
  },
  'ticket.reply': {
    label: 'Support update',
    variables: ['company', 'subject', 'link'],
    subject: 'Support ticket: {{subject}}',
    body: 'Your support ticket has been updated. Sign in to read it: {{link}}',
  },
  'renewal.ready': {
    label: 'Renewal invoice',
    variables: ['company', 'service', 'link'],
    subject: 'Hosting renewal invoice',
    body: 'A renewal invoice for {{service}} is ready. Sign in to view it: {{link}}',
  },
  'invoice.issued': {
    label: 'Invoice PDF email',
    variables: ['company', 'number', 'amount', 'balance', 'currency', 'status', 'link'],
    subject: 'Invoice {{number}}',
    body: 'Your invoice {{number}} is attached.\nStatus: {{status}}\nTotal: {{amount}}\nBalance due: {{balance}}\n\nView your invoice: {{link}}',
  },
  'invoice.paid': {
    label: 'Payment receipt PDF email',
    variables: ['company', 'number', 'amount', 'balance', 'currency', 'status', 'link'],
    subject: 'Payment received — {{number}}',
    body: 'Payment received for invoice {{number}}. Your PDF receipt is attached.\nTotal: {{amount}}\nBalance due: {{balance}}\n\nView your invoice: {{link}}',
  },
} as const;
export type NotificationKey = keyof typeof notificationTemplates;
export function interpolate(template: string, variables: Record<string, string>) {
  return template.replace(/\{\{([a-zA-Z]+)\}\}/g, (_, key: string) => variables[key] || '');
}
