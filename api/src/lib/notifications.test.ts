import { beforeEach, describe, expect, it, vi } from 'vitest';
import nodemailer from 'nodemailer';
import webPush from 'web-push';
import {
  initializeNotifications,
  notificationTemplates,
  sendEmailNotification,
  sendPriceAlert,
  sendPushNotification,
} from '../lib/notifications.js';

vi.mock('nodemailer');
vi.mock('web-push');

const mockTransporter = {
  sendMail: vi.fn(),
};

describe('notifications', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    vi.mocked(nodemailer.createTransport).mockReturnValue(mockTransporter as any);
    await initializeNotifications();
  });

  it('sends email notifications when SMTP is configured', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    mockTransporter.sendMail.mockResolvedValueOnce({});

    const result = await sendEmailNotification(
      'user@example.com',
      'Test Subject',
      '<p>Test HTML</p>',
      'Test text'
    );

    expect(result).toBe(true);
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: {
        user: undefined,
        pass: undefined,
      },
    });
    expect(mockTransporter.sendMail).toHaveBeenCalledWith({
      from: 'Price Tracker Iraq <noreply@price-tracker-iraq.com>',
      to: 'user@example.com',
      subject: 'Test Subject',
      html: '<p>Test HTML</p>',
      text: 'Test text',
    });
  });

  it('returns false when email transport is not configured', async () => {
    const result = await sendEmailNotification(
      'user@example.com',
      'Test Subject',
      '<p>Test HTML</p>'
    );

    expect(result).toBe(false);
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
    expect(mockTransporter.sendMail).not.toHaveBeenCalled();
  });

  it('returns false when email sending fails', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    mockTransporter.sendMail.mockRejectedValueOnce(new Error('Send failed'));

    const result = await sendEmailNotification(
      'user@example.com',
      'Test Subject',
      '<p>Test HTML</p>'
    );

    expect(result).toBe(false);
  });

  it('sends push notifications successfully', async () => {
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test',
      keys: { p256dh: 'key1', auth: 'key2' },
    };

    vi.mocked(webPush.sendNotification).mockResolvedValueOnce(undefined as any);

    const result = await sendPushNotification(subscription as any, { title: 'Test' });

    expect(result).toBe(true);
    expect(webPush.sendNotification).toHaveBeenCalledWith(
      subscription,
      JSON.stringify({ title: 'Test' })
    );
  });

  it('returns false when push notifications fail', async () => {
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test',
      keys: { p256dh: 'key1', auth: 'key2' },
    };

    vi.mocked(webPush.sendNotification).mockRejectedValueOnce(new Error('Push failed'));

    const result = await sendPushNotification(subscription as any, { title: 'Test' });

    expect(result).toBe(false);
  });

  it('sends price alerts via email', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    mockTransporter.sendMail.mockResolvedValueOnce({});

    await sendPriceAlert(
      'user@example.com',
      'Test Product',
      100000,
      80000,
      'https://example.com/product'
    );

    expect(mockTransporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Price Drop Alert: Test Product',
      })
    );
  });

  it('builds the price-drop notification template', () => {
    const template = notificationTemplates.priceDrop(
      'Test Product',
      100000,
      80000,
      'https://example.com/product'
    );

    expect(template.subject).toBe('Price Drop: Test Product');
    expect(template.html).toContain('Test Product');
    expect(template.html).toContain('100000 IQD');
    expect(template.html).toContain('80000 IQD');
    expect(template.html).toContain('https://example.com/product');
  });

  it('builds the welcome notification template', () => {
    const template = notificationTemplates.welcome('John Doe');

    expect(template.subject).toBe('Welcome to Price Tracker Iraq!');
    expect(template.html).toContain('John Doe');
    expect(template.html).toContain('Welcome to Price Tracker Iraq!');
  });

  it('builds the system alert notification template', () => {
    const template = notificationTemplates.systemAlert(
      'Test Alert',
      'This is a test message',
      'warning'
    );

    expect(template.subject).toBe('System Alert: Test Alert');
    expect(template.html).toContain('Test Alert');
    expect(template.html).toContain('This is a test message');
  });
});
