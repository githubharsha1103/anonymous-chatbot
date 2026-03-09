# Anonymous Chatbot

This is an anonymous chatbot built using Telegraf, a library for creating Telegram bots. The bot allows users to start anonymous chats with random partners.

## Features

- **/start**: Start the bot and get a welcome message.
- **/search**: Search for a new chat partner.
- **/next**: Skip the current chat and search for a new one.
- **/end**: End the current chat.
- **/help**: See the available commands.

## How It Works

1. **/start**: Initializes the bot and provides instructions to the user.
2. **/search**: Puts the user in a queue to find a chat partner. If another user is already waiting, it pairs them up.
3. **/next**: Allows the user to skip the current chat and search for a new partner.
4. **/end**: Ends the current chat and removes both users from the chat.
5. **/help**: Lists all available commands and their descriptions.

## Hosting the Bot

To host the bot yourself, follow these steps:

1. **Clone the repository**:
    ```sh
    git clone https://github.com/sea-deep/anonymous-chatbot.git
    cd anonymous-chatbot
    ```

2. **Install dependencies**:
    ```sh
    npm install
    ```

3. **Set up environment variables**:
   
   **For Local Development:**
   - Copy `.env.example` to `.env`
   - Fill in your real credentials in `.env` (this file is gitignored)
   
   **For Production Deployment:**
   - Set environment variables in your hosting platform (Render, Heroku, etc.)
   
   **Required Environment Variables:**
   ```env
   BOT_TOKEN=your-telegram-bot-token
   ADMIN_IDS=your-admin-user-ids
   GROUP_CHAT_ID=your-group-chat-id
   MONGODB_URI=your-mongodb-connection-string
   DB_NAME=telugu_anomybot
   GROUP_INVITE_LINK=https://t.me/your-group-link
   ```
   
   **Optional Environment Variables:**
   ```env
   PORT=3000
   WEBHOOK_PATH=/webhook
   WEBAPP_URL=https://your-domain.com
   ```

4. **Build the project**:
    ```sh
    npm run build
    ```

5. **Start the bot**:
    ```sh
    npm start
    ```

## Security Notes

- Never commit real credentials to version control
- Use `.env` for local development (automatically gitignored)
- Set environment variables directly in your production hosting platform
- The `.env.local.example` file shows the format for local overrides

## Template Repository

This project was created using the following template repo: [Telegram Bot Template](https://github.com/sea-deep/telegram-bot-template).

## License

This project is licensed under the MIT License.