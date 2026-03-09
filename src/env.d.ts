declare namespace NodeJS {
    interface ProcessEnv {
      // Required
      BOT_TOKEN: string;
      
      // Admin Configuration
      ADMIN_IDS: string;
      
      // MongoDB Configuration
      MONGODB_URI: string;
      DB_NAME: string;
      
      // Server Configuration
      PORT: string;
      WEBHOOK_PATH: string;
      WEBHOOK_URL: string;
      RENDER_EXTERNAL_HOSTNAME: string;
      
      // Group Configuration
      GROUP_CHAT_ID: string;
      GROUP_INVITE_LINK: string;
      
      // Web API Key (for securing admin endpoints)
      WEB_API_KEY?: string;
    }
  }

