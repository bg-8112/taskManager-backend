const SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/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";

const sendSlackNotification = async (message, channel = '#tasks-manager') => {
  try {
    
    const { default: fetch } = await import('node-fetch');

    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text: message, channel: channel })
    });

    if (!response.ok) {
      throw new Error('Failed to send Slack notification');
    }
  } catch (error) {
    console.error('Error sending Slack notification:', error);
  }
};

module.exports = { sendSlackNotification };
