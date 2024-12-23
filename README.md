# Say It Again

[<img src="https://img.youtube.com/vi/D5mIer4qmdE/0.jpg">](https://youtu.be/D5mIer4qmdE "Authenticate your OpenAI Realtime API
")


This is an authenticated example based on the [Cloudflare OpenAI Realtime Relay on Workers starter template](https://github.com/cloudflare/openai-workers-relay).

This makes use of the [OpenAI Realtime API](https://platform.openai.com/docs/api-reference/realtime) to "parrot" back what you said but in character.

This uses [WavTools](https://www.npmjs.com/package/wavtools) for most of the clientside browser heavy lifting which was introduced in the [OpenAI Realtime Console](https://github.com/openai/openai-realtime-console) but split out for reuse.

## Installation

```bash
npm install
```

## Development

Copy [.dev.vars.example](./.dev.vars.example) to `.dev.vars` and add your keys and secrets.

```bash
npm run dev
```

## Deploy to Region Earth

Set up your secrets

```bash
npx wrangler secret put OPENAI_API_KEY
```

```bash
npx wrangler secret put JWT_SECRET
```

```bash
npm run deploy
```