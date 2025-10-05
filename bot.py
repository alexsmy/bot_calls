import os
import sys
import threading
from telegram import Update, WebAppInfo, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, ContextTypes

# Импортируем наше FastAPI приложение
from main import app as fastapi_app

# URL веб-приложения, который вы получите от Replit или другого хостинга
WEB_APP_URL = os.environ.get("WEB_APP_URL")

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Отправляет приветственное сообщение с кнопкой для запуска Web App."""
    if not WEB_APP_URL:
        await update.message.reply_text(
            "Извините, URL веб-приложения не настроен. "
            "Администратор должен установить переменную окружения WEB_APP_URL."
        )
        return

    keyboard = [
        [InlineKeyboardButton("📞 Открыть звонки", web_app=WebAppInfo(url=WEB_APP_URL))]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)

    await update.message.reply_text(
        "👋 Добро пожаловать в голосовой мессенджер!\n\n"
        "Нажмите на кнопку ниже, чтобы увидеть, кто в сети, и начать звонок.",
        reply_markup=reply_markup,
    )

def run_fastapi():
    """Запускает FastAPI сервер в отдельном потоке."""
    import uvicorn
    uvicorn.run(fastapi_app, host="0.0.0.0", port=8000)

def main() -> None:
    """Основная функция для запуска бота и веб-сервера."""
    bot_token = os.environ.get("BOT_TOKEN")
    if not bot_token:
        print("КРИТИЧЕСКАЯ ОШИБКА: Токен бота (BOT_TOKEN) не найден.", file=sys.stderr)
        sys.exit(1)

    # Запускаем FastAPI в фоновом потоке
    fastapi_thread = threading.Thread(target=run_fastapi)
    fastapi_thread.daemon = True
    fastapi_thread.start()
    print("FastAPI сервер запущен в фоновом режиме.")

    # Настраиваем и запускаем Telegram бота
    application = Application.builder().token(bot_token).build()
    application.add_handler(CommandHandler("start", start))

    print("Telegram бот запускается...")
    application.run_polling()

if __name__ == "__main__":
    main()
