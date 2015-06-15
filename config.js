module.exports = {
    port:         (process.env.PORT && parseInt(process.env.PORT)) || 4000,
    api_endpoint: process.env.API_ENDPOINT || 'http://localhost:3000/v1',
    app_id:       (process.env.APP_ID && parseInt(process.env.APP_ID)) || 1007,
    app_secret:   process.env.APP_SECRET || '3fc58b9e-3426-4705-9ad8-85ca32603d4b',
    database_url: process.env.DATABASE_URL || 'postgres://localhost:5432/chat-db'
};
