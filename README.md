```
███╗   ██╗ ██████╗ ██╗     ███████╗██████╗  ██████╗ ███████╗
████╗  ██║██╔═══██╗██║     ██╔════╝██╔══██╗██╔════╝ ██╔════╝
██╔██╗ ██║██║   ██║██║     █████╗  ██║  ██║██║  ███╗█████╗
██║╚██╗██║██║   ██║██║     ██╔══╝  ██║  ██║██║   ██║██╔══╝
██║ ╚████║╚██████╔╝███████╗███████╗██████╔╝╚██████╔╝███████╗
╚═╝  ╚═══╝ ╚═════╝ ╚══════╝╚══════╝╚═════╝  ╚═════╝ ╚══════╝
```

<p align="center">
  <strong>Your own second brain that actually remembers everything.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  <a href="https://youtube.com/@kenkaidoesai"><img src="https://img.shields.io/badge/YouTube-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="YouTube"></a>
  <a href="https://skool.com/kenkai"><img src="https://img.shields.io/badge/Skool-Community-7C3AED?style=for-the-badge" alt="Skool"></a>
</p>

**Noledge** is a place to dump everything you read, watch, and save, then just *talk to it* like a friend who actually paid attention. PDFs, Word docs, screenshots, web articles, YouTube videos, research papers, random notes. Throw it all in. Then ask questions and get real answers, pulled straight from your own stuff.

It runs on your own computer. Your knowledge stays yours.

---

## Why this exists

We all save things we never look at again. The bookmarked article. The 2-hour video you swore you'd rewatch. The PDF buried in your downloads folder. It all just... disappears into the pile.

Noledge fixes the pile. You feed it everything, and it quietly reads, understands, and remembers all of it. Then whenever you need something, you just ask, and it answers using *your* sources, not some random thing off the internet.

It's like having a research assistant who's read everything you've ever saved and never forgets a word.

---

## The magic part (a.k.a. "RAG")

Here's the thing that makes this actually work, explained simply.

Normal AI chatbots are smart, but they only know what they were trained on. They don't know *your* notes, *your* documents, or that video you watched last Tuesday. And if you ask about something they don't know, they'll often just make stuff up.

Noledge does it differently. When you ask a question, it first goes and **finds the exact bits from your own files that matter**, then hands those to the AI to answer with. So instead of guessing, the AI is reading from your real sources every single time.

That's the whole trick. Find the right stuff first, then answer. The fancy name for it is "RAG," but you don't need to remember that. What matters is:

- **The answers come from your actual documents**, not made-up nonsense.
- **It tells you where it got each answer**, so you can trust it and dig deeper.
- **The more you add, the smarter it gets** about *your* world specifically.

You end up with an AI that knows what *you* know, plus everything you forgot.

---

## What it actually does

### Dump in anything
PDFs, Word docs, PowerPoints, spreadsheets, plain notes, web articles, even screenshots and photos of text (it reads images too). Paste a link and it grabs the article. Drop a YouTube link and it pulls the whole transcript. It all becomes searchable.

### Just ask
Chat with everything you've saved like it's one big brain. Ask a question, get an answer built from your real sources, with links back to where it came from. No more "where did I read that again?"

### The Brain
A living 3D map of everything you've added and how it all connects. Watch your knowledge grow into a glowing web of ideas. It's genuinely fun to spin around and explore.

### Automate the boring part
Tell Noledge to keep an eye on things for you. Point it at your favorite blogs, YouTube channels, or research feeds, and it'll automatically pull in new stuff as it drops, so your brain keeps growing while you sleep.

### Bring your own AI
Works with all the big AI providers (OpenAI, Anthropic/Claude, Google Gemini, DeepSeek, and more). Use whichever one you already pay for, or mix and match.

### It's all yours
Everything lives on your own computer in a single file. No cloud account, no subscription to Noledge, no one snooping on your notes.

---

## Getting started

You'll need [Node.js](https://nodejs.org) installed (grab the "LTS" version, click through the installer, done).

**1. Download the project**

```bash
git clone https://github.com/KenKaiii/noledge.git
cd noledge
```

**2. Install it**

```bash
npm install
```

**3. Add at least one AI key**

Make a file called `.env.local` in the project folder and put your key(s) in it. You need an OpenAI key (it powers the "memory" part), plus any others you want to chat with:

```
OPENAI_API_KEY=your-openai-key-here
ANTHROPIC_API_KEY=your-claude-key-here
GEMINI_API_KEY=your-gemini-key-here
```

Get an OpenAI key at [platform.openai.com](https://platform.openai.com/api-keys). The rest are optional, add only the ones you want.

**4. Start it up**

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. That's it. Start dumping in your stuff and asking questions.

---

## Tips

- **Start with one thing.** Upload a single PDF or paste one article, then ask it a question. Once you see it work, you'll get the idea fast.
- **The OpenAI key is the important one.** It's what lets Noledge "understand" and remember your documents. Everything else is optional.
- **Add things over time.** This gets more useful the more you feed it. Make it a habit to drop in anything worth remembering.

---

## Community

- [YouTube @kenkaidoesai](https://youtube.com/@kenkaidoesai) — tutorials and demos
- [Skool community](https://skool.com/kenkai) — come hang out and build with us

---

## License

MIT — do whatever you want with it.

---

<p align="center">
  <strong>Stop losing what you learn. Keep it all, and just ask.</strong>
</p>
