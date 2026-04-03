# Auzora IT Services — Website Brief

## Company
- Name: Auzora IT Services
- Tagline: something punchy about AI-powered IT solutions
- Owner: Auzi Howard

## Logo
- File: ./logo.png
- Colorful gradient triangle with spiral: blue (bottom-left) → purple/magenta (center) → orange/red (top-right)

## Color Palette (from logo)
- Primary gradient: linear from #3B82F6 (blue) → #8B5CF6 (purple) → #EC4899 (pink/magenta) → #F97316 (orange) → #EF4444 (red)
- Background: very dark (#0A0A0F or #0D0D1A — near black, space-like)
- Text: white / light gray
- Accent: use the gradient on CTAs, headings, borders

## Service to Promote: Atlas AI
- Product name: Atlas AI
- What it is: AI-powered phone service for businesses — handles inbound calls 24/7, answers questions, qualifies leads, books appointments. Powered by GPT-4o Realtime API (ultra-low latency, ~300ms response)
- Target customers: Small/medium businesses (real estate agents, law firms, medical offices, service companies) who miss calls and lose leads
- Key benefits:
  - Never miss a call again
  - 24/7 availability
  - Sounds natural, not robotic
  - Qualifies leads automatically
  - Books appointments
  - Fraction of the cost of a receptionist

## Page Structure
1. **Hero section**: Logo + company name + bold headline + subheadline + CTA button ("Get Early Access" or "Book a Demo")
2. **Problem section**: "Businesses lose $X billion from missed calls" — pain points
3. **Atlas AI section**: Product showcase, key features with icons
4. **How it works**: 3-step simple flow (Connect your number → Customize your AI → Never miss a call)
5. **Pricing teaser**: "Starting at $X/month" or "Contact for pricing" — keep it vague for now
6. **CTA / Contact section**: Simple form (Name, Business, Phone, Email) + submit button
7. **Footer**: Auzora IT Services © 2026, contact info

## Design Style
- Dark, modern, premium feel
- Heavy use of the gradient on text highlights, borders, buttons
- Glassmorphism cards (frosted glass effect)
- Subtle animated gradient background or particle effect
- Clean sans-serif font (Inter or Geist)
- Mobile responsive

## Tech Stack
- Pure HTML/CSS/JS (single index.html file, no framework needed)
- Tailwind CSS via CDN
- Any icons via heroicons or lucide CDN
- Form should POST to a placeholder endpoint (we'll hook it to n8n later)
- Should be deployable on Netlify/Vercel with zero config

## Output
- index.html (complete, self-contained)
- Any assets referenced should be inline or CDN-linked
- The logo.png is in the same directory — reference it as ./logo.png
