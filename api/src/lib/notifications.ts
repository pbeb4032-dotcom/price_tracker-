import nodemailer from 'nodemailer';
import webPush from 'web-push';
import { getLogger } from './monitoring.js';

// Email configuration
let emailTransporter: nodemailer.Transporter | null = null;

export const initializeNotifications = async () => {
  // Initialize email transporter
  if (process.env.SMTP_HOST) {
    emailTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  // Initialize web push
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    try {
      webPush.setVapidDetails(
        'mailto:' + (process.env.VAPID_EMAIL || 'admin@price-tracker-iraq.com'),
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
      );
    } catch (error) {
      getLogger().warn('Invalid VAPID key, push notifications turned off:', error);
    }
  }
};

// Email notifications
export const sendEmailNotification = async (
  to: string,
  subject: string,
  html: string,
  text?: string
): Promise<boolean> => {
  if (!emailTransporter) {
    getLogger().warn('Email transporter not configured');
    return false;
  }

  try {
    await emailTransporter.sendMail({
      from: process.env.SMTP_FROM || 'Price Tracker Iraq <noreply@price-tracker-iraq.com>',
      to,
      subject,
      html,
      text,
    });
    getLogger().info(`Email sent to ${to}: ${subject}`);
    return true;
  } catch (error) {
    getLogger().error('Email send error:', error);
    return false;
  }
};

// Push notifications
export const sendPushNotification = async (
  subscription: webPush.PushSubscription,
  payload: any
): Promise<boolean> => {
  try {
    await webPush.sendNotification(subscription, JSON.stringify(payload));
    getLogger().info('Push notification sent');
    return true;
  } catch (error) {
    getLogger().error('Push notification error:', error);
    return false;
  }
};

// Price alert notifications
export const sendPriceAlert = async (
  userEmail: string,
  productName: string,
  oldPrice: number,
  newPrice: number,
  url: string
): Promise<void> => {
  const subject = `Price Drop Alert: ${productName}`;
  const html = `
    <h2>Price Drop Alert!</h2>
    <p><strong>${productName}</strong></p>
    <p>Price changed from <span style="text-decoration: line-through;">${oldPrice} IQD</span> to <strong>${newPrice} IQD</strong></p>
    <p>Savings: <strong>${oldPrice - newPrice} IQD (${Math.round(((oldPrice - newPrice) / oldPrice) * 100)}%)</strong></p>
    <p><a href="${url}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">View Product</a></p>
    <br>
    <p>Best regards,<br>Price Tracker Iraq Team</p>
  `;

  await sendEmailNotification(userEmail, subject, html);
};

// Bulk notifications
export const sendBulkNotifications = async (
  notifications: Array<{
    type: 'email' | 'push';
    recipient: string | webPush.PushSubscription;
    subject?: string;
    content: any;
  }>
): Promise<void> => {
  const promises = notifications.map(async (notification) => {
    if (notification.type === 'email') {
      return sendEmailNotification(
        notification.recipient as string,
        notification.subject || 'Price Tracker Iraq Notification',
        notification.content.html,
        notification.content.text
      );
    } else if (notification.type === 'push') {
      return sendPushNotification(
        notification.recipient as webPush.PushSubscription,
        notification.content
      );
    }
  });

  await Promise.allSettled(promises);
};

// Notification templates
export const notificationTemplates = {
  priceDrop: (productName: string, oldPrice: number, newPrice: number, url: string) => ({
    subject: `Price Drop: ${productName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2e7d32;">🔔 Price Drop Alert!</h2>
        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0;">${productName}</h3>
          <p style="font-size: 18px;">
            <span style="text-decoration: line-through; color: #666;">${oldPrice} IQD</span>
            <span style="color: #2e7d32; font-weight: bold;"> → ${newPrice} IQD</span>
          </p>
          <p style="color: #2e7d32; font-weight: bold;">
            You save: ${oldPrice - newPrice} IQD (${Math.round(((oldPrice - newPrice) / oldPrice) * 100)}%)
          </p>
        </div>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${url}" style="background-color: #2e7d32; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">View Product</a>
        </div>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #666; font-size: 14px;">Price Tracker Iraq - Monitoring Iraqi market prices</p>
      </div>
    `,
  }),

  welcome: (userName: string) => ({
    subject: 'Welcome to Price Tracker Iraq!',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2e7d32;">Welcome to Price Tracker Iraq! 🎉</h2>
        <p>Hi ${userName},</p>
        <p>Thank you for joining Price Tracker Iraq! We're excited to help you track prices across Iraqi e-commerce platforms.</p>
        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3>What you can do:</h3>
          <ul>
            <li>Track prices for your favorite products</li>
            <li>Get notified when prices drop</li>
            <li>Compare prices across multiple Iraqi stores</li>
            <li>Access historical price data</li>
          </ul>
        </div>
        <p>Get started by adding your first product to track!</p>
        <br>
        <p>Best regards,<br>The Price Tracker Iraq Team</p>
      </div>
    `,
  }),

  systemAlert: (title: string, message: string, severity: 'info' | 'warning' | 'error' = 'info') => ({
    subject: `System Alert: ${title}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: ${severity === 'error' ? '#d32f2f' : severity === 'warning' ? '#f57c00' : '#2e7d32'};">System Alert</h2>
        <h3>${title}</h3>
        <p>${message}</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #666; font-size: 14px;">Price Tracker Iraq System Monitoring</p>
      </div>
    `,
  }),
};