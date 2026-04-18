const pptxgen = require("pptxgenjs");

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.author = "0xSanei";
pres.title = "Darwinia on Arc — Pitch Deck";

// Colors
const BG = "0A0E27";
const BG_CARD = "141937";
const PURPLE = "7C3AED";
const BLUE = "2563EB";
const CYAN = "06B6D4";
const WHITE = "FFFFFF";
const MUTED = "94A3B8";
const GREEN = "22C55E";
const CARD_BORDER = "1E2548";

// Helpers - fresh objects each time to avoid pptxgenjs mutation bug
const cardShadow = () => ({ type: "outer", blur: 8, offset: 3, angle: 135, color: "000000", opacity: 0.3 });

// ─── SLIDE 1: TITLE ───
{
  const slide = pres.addSlide();
  slide.background = { color: BG };

  // Decorative accent shapes
  slide.addShape(pres.shapes.OVAL, { x: -1.5, y: -1.5, w: 4, h: 4, fill: { color: PURPLE, transparency: 85 } });
  slide.addShape(pres.shapes.OVAL, { x: 7.5, y: 3, w: 4, h: 4, fill: { color: CYAN, transparency: 85 } });

  // Title
  slide.addText("Darwinia on Arc", {
    x: 0.8, y: 1.2, w: 8.4, h: 1.2,
    fontSize: 48, fontFace: "Arial Black", color: WHITE,
    bold: true, align: "left", margin: 0,
  });

  // Subtitle
  slide.addText("Evolve Better Strategies. Pay Per Insight.", {
    x: 0.8, y: 2.4, w: 8.4, h: 0.7,
    fontSize: 22, fontFace: "Calibri", color: CYAN,
    italic: true, align: "left", margin: 0,
  });

  // Accent line
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.8, y: 3.3, w: 2.5, h: 0.06,
    fill: { color: PURPLE },
  });

  // Tagline
  slide.addText("AI-driven genetic algorithm optimization as a service,\nsettled with $0.001 USDC Nanopayments on Arc Network.", {
    x: 0.8, y: 3.6, w: 7, h: 0.8,
    fontSize: 14, fontFace: "Calibri", color: MUTED,
    align: "left", margin: 0,
  });

  // Bottom bar
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 5.1, w: 10, h: 0.525,
    fill: { color: "0D1230" },
  });
  slide.addText("Agentic Economy on Arc Hackathon 2026  |  Built by 0xSanei", {
    x: 0.8, y: 5.1, w: 8.4, h: 0.525,
    fontSize: 12, fontFace: "Calibri", color: MUTED,
    align: "left", valign: "middle", margin: 0,
  });
}

// ─── SLIDE 2: PROBLEM ───
{
  const slide = pres.addSlide();
  slide.background = { color: BG };

  slide.addText("The Problem", {
    x: 0.8, y: 0.4, w: 8.4, h: 0.8,
    fontSize: 36, fontFace: "Arial Black", color: WHITE,
    bold: true, align: "left", margin: 0,
  });

  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.8, y: 1.15, w: 1.5, h: 0.05,
    fill: { color: PURPLE },
  });

  const problems = [
    { num: "01", title: "$50K-500K/year", desc: "Trading strategy development requires quant teams,\ndedicated infrastructure, and months of backtesting" },
    { num: "02", title: "No Access for Retail", desc: "Individual traders are locked out of algorithmic\noptimization tools that institutions take for granted" },
    { num: "03", title: "Subscription Trap", desc: "Existing platforms charge monthly fees whether you\nuse them or not \u2014 pay for access, not results" },
  ];

  problems.forEach((p, i) => {
    const yBase = 1.6 + i * 1.25;

    // Card background
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0.8, y: yBase, w: 8.4, h: 1.05,
      fill: { color: BG_CARD },
      shadow: cardShadow(),
    });

    // Left accent bar
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0.8, y: yBase, w: 0.07, h: 1.05,
      fill: { color: PURPLE },
    });

    // Number
    slide.addText(p.num, {
      x: 1.1, y: yBase, w: 0.6, h: 1.05,
      fontSize: 28, fontFace: "Consolas", color: PURPLE,
      bold: true, align: "center", valign: "middle", margin: 0,
    });

    // Title
    slide.addText(p.title, {
      x: 1.8, y: yBase + 0.1, w: 3, h: 0.4,
      fontSize: 18, fontFace: "Calibri", color: WHITE,
      bold: true, align: "left", margin: 0,
    });

    // Description
    slide.addText(p.desc, {
      x: 1.8, y: yBase + 0.48, w: 7, h: 0.5,
      fontSize: 12, fontFace: "Calibri", color: MUTED,
      align: "left", margin: 0,
    });
  });
}

// ─── SLIDE 3: SOLUTION ───
{
  const slide = pres.addSlide();
  slide.background = { color: BG };

  slide.addText("Strategy Evolution as a Service", {
    x: 0.8, y: 0.4, w: 8.4, h: 0.8,
    fontSize: 32, fontFace: "Arial Black", color: WHITE,
    bold: true, align: "left", margin: 0,
  });

  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.8, y: 1.15, w: 1.5, h: 0.05,
    fill: { color: CYAN },
  });

  const steps = [
    { num: "1", title: "Post a Job", desc: "Define target (BTC/USDT),\nbudget ($0.02+), generations", color: PURPLE },
    { num: "2", title: "Agent Evolves", desc: "Autonomous GA agent evolves\n50+ variants per generation", color: BLUE },
    { num: "3", title: "Pay Per Insight", desc: "Unlock results at $0.001\nUSDC via x402 Nanopayments", color: CYAN },
    { num: "4", title: "Deploy", desc: "Export winning strategy\nDNA (17 genes)", color: GREEN },
  ];

  steps.forEach((s, i) => {
    const xBase = 0.8 + i * 2.25;
    const yBase = 1.5;

    // Card
    slide.addShape(pres.shapes.RECTANGLE, {
      x: xBase, y: yBase, w: 2.0, h: 3.2,
      fill: { color: BG_CARD },
      shadow: cardShadow(),
    });

    // Top accent
    slide.addShape(pres.shapes.RECTANGLE, {
      x: xBase, y: yBase, w: 2.0, h: 0.06,
      fill: { color: s.color },
    });

    // Number circle
    slide.addShape(pres.shapes.OVAL, {
      x: xBase + 0.65, y: yBase + 0.3, w: 0.7, h: 0.7,
      fill: { color: s.color, transparency: 80 },
    });
    slide.addText(s.num, {
      x: xBase + 0.65, y: yBase + 0.3, w: 0.7, h: 0.7,
      fontSize: 24, fontFace: "Arial Black", color: s.color,
      bold: true, align: "center", valign: "middle", margin: 0,
    });

    // Title
    slide.addText(s.title, {
      x: xBase + 0.15, y: yBase + 1.2, w: 1.7, h: 0.5,
      fontSize: 16, fontFace: "Calibri", color: WHITE,
      bold: true, align: "center", margin: 0,
    });

    // Description
    slide.addText(s.desc, {
      x: xBase + 0.15, y: yBase + 1.7, w: 1.7, h: 1.0,
      fontSize: 11, fontFace: "Calibri", color: MUTED,
      align: "center", margin: 0,
    });

    // Arrow between cards
    if (i < 3) {
      slide.addText("\u25B6", {
        x: xBase + 2.0, y: yBase + 1.3, w: 0.25, h: 0.4,
        fontSize: 14, color: MUTED, align: "center", valign: "middle", margin: 0,
      });
    }
  });
}

// ─── SLIDE 4: ARCHITECTURE ───
{
  const slide = pres.addSlide();
  slide.background = { color: BG };

  slide.addText("Architecture", {
    x: 0.8, y: 0.4, w: 8.4, h: 0.7,
    fontSize: 36, fontFace: "Arial Black", color: WHITE,
    bold: true, align: "left", margin: 0,
  });

  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.8, y: 1.05, w: 1.5, h: 0.05,
    fill: { color: BLUE },
  });

  // Three horizontal lanes
  const lanes = [
    { label: "USER LAYER", color: PURPLE, items: ["Next.js Dashboard", "Create Job", "View Results", "Unlock (x402)"], y: 1.4 },
    { label: "AGENT LAYER", color: BLUE, items: ["Poll Supabase", "Claim Job", "Python Darwinia CLI", "Write Iterations"], y: 2.7 },
    { label: "SETTLEMENT", color: CYAN, items: ["HTTP 402 Gate", "EIP-3009 Sign", "Relay Submit", "Arc On-chain TX"], y: 4.0 },
  ];

  lanes.forEach((lane) => {
    // Lane label
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0.8, y: lane.y, w: 1.6, h: 1.0,
      fill: { color: lane.color, transparency: 80 },
    });
    slide.addText(lane.label, {
      x: 0.8, y: lane.y, w: 1.6, h: 1.0,
      fontSize: 10, fontFace: "Consolas", color: lane.color,
      bold: true, align: "center", valign: "middle", margin: 0,
    });

    // Items in the lane
    lane.items.forEach((item, j) => {
      const xPos = 2.7 + j * 1.8;
      slide.addShape(pres.shapes.RECTANGLE, {
        x: xPos, y: lane.y + 0.1, w: 1.6, h: 0.8,
        fill: { color: BG_CARD },
        line: { color: CARD_BORDER, width: 1 },
      });
      slide.addText(item, {
        x: xPos, y: lane.y + 0.1, w: 1.6, h: 0.8,
        fontSize: 10, fontFace: "Calibri", color: WHITE,
        align: "center", valign: "middle", margin: 0,
      });

      // Arrow
      if (j < 3) {
        slide.addText("\u2192", {
          x: xPos + 1.55, y: lane.y + 0.25, w: 0.3, h: 0.5,
          fontSize: 14, color: MUTED, align: "center", valign: "middle", margin: 0,
        });
      }
    });

    // Vertical arrows between lanes
    if (lane.y < 4.0) {
      slide.addText("\u25BC", {
        x: 1.3, y: lane.y + 0.95, w: 0.6, h: 0.4,
        fontSize: 14, color: MUTED, align: "center", valign: "middle", margin: 0,
      });
    }
  });
}

// ─── SLIDE 5: ARC INTEGRATION ───
{
  const slide = pres.addSlide();
  slide.background = { color: BG };

  slide.addText("Built on Arc's Unique Primitives", {
    x: 0.8, y: 0.4, w: 8.4, h: 0.8,
    fontSize: 32, fontFace: "Arial Black", color: WHITE,
    bold: true, align: "left", margin: 0,
  });

  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.8, y: 1.15, w: 1.5, h: 0.05,
    fill: { color: CYAN },
  });

  const features = [
    { title: "Native USDC", desc: "$0.001 micropayments economically viable.\nNo bridge overhead, no wrapped tokens.", color: PURPLE, x: 0.8, y: 1.5 },
    { title: "x402 Protocol", desc: "HTTP 402 payment-gated API responses.\nPay-per-call, not pay-per-month.", color: BLUE, x: 5.15, y: 1.5 },
    { title: "EIP-3009 Meta-TX", desc: "Gas-free client experience.\nRelay wallet submits on-chain.", color: CYAN, x: 0.8, y: 3.35 },
    { title: "Agent Reputation", desc: "On-chain leaderboard incentivizes\nworker network growth.", color: GREEN, x: 5.15, y: 3.35 },
  ];

  features.forEach((f) => {
    // Card
    slide.addShape(pres.shapes.RECTANGLE, {
      x: f.x, y: f.y, w: 4.05, h: 1.55,
      fill: { color: BG_CARD },
      shadow: cardShadow(),
    });

    // Left accent
    slide.addShape(pres.shapes.RECTANGLE, {
      x: f.x, y: f.y, w: 0.07, h: 1.55,
      fill: { color: f.color },
    });

    // Title
    slide.addText(f.title, {
      x: f.x + 0.3, y: f.y + 0.15, w: 3.5, h: 0.45,
      fontSize: 20, fontFace: "Calibri", color: WHITE,
      bold: true, align: "left", margin: 0,
    });

    // Description
    slide.addText(f.desc, {
      x: f.x + 0.3, y: f.y + 0.65, w: 3.5, h: 0.75,
      fontSize: 13, fontFace: "Calibri", color: MUTED,
      align: "left", margin: 0,
    });
  });
}

// ─── SLIDE 6: DEMO HIGHLIGHTS ───
{
  const slide = pres.addSlide();
  slide.background = { color: BG };

  slide.addText("Live Demo", {
    x: 0.8, y: 0.4, w: 8.4, h: 0.8,
    fontSize: 36, fontFace: "Arial Black", color: WHITE,
    bold: true, align: "left", margin: 0,
  });

  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.8, y: 1.15, w: 1.5, h: 0.05,
    fill: { color: GREEN },
  });

  const checks = [
    "Production deployed: darwinia-on-arc.vercel.app",
    "Agent Worker running (PM2), auto-claims and processes jobs",
    "x402 payment gate: 402 \u2192 client signs \u2192 relay settles on-chain",
    "EIP-3009 TransferWithAuthorization confirmed on Arc Testnet",
    "17-gene Champion DNA visualization with fitness metrics",
    "Real-time Supabase streaming of evolution progress",
  ];

  checks.forEach((text, i) => {
    const yPos = 1.5 + i * 0.62;

    // Row background (alternating)
    if (i % 2 === 0) {
      slide.addShape(pres.shapes.RECTANGLE, {
        x: 0.8, y: yPos, w: 8.4, h: 0.55,
        fill: { color: BG_CARD },
      });
    }

    // Checkmark circle
    slide.addShape(pres.shapes.OVAL, {
      x: 1.0, y: yPos + 0.08, w: 0.38, h: 0.38,
      fill: { color: GREEN, transparency: 75 },
    });
    slide.addText("\u2713", {
      x: 1.0, y: yPos + 0.08, w: 0.38, h: 0.38,
      fontSize: 14, fontFace: "Arial", color: GREEN,
      bold: true, align: "center", valign: "middle", margin: 0,
    });

    // Text
    slide.addText(text, {
      x: 1.6, y: yPos, w: 7.4, h: 0.55,
      fontSize: 14, fontFace: "Calibri", color: WHITE,
      align: "left", valign: "middle", margin: 0,
    });
  });
}

// ─── SLIDE 7: VISION & CONTACT ───
{
  const slide = pres.addSlide();
  slide.background = { color: BG };

  // Decorative
  slide.addShape(pres.shapes.OVAL, { x: 7, y: -1, w: 5, h: 5, fill: { color: PURPLE, transparency: 90 } });
  slide.addShape(pres.shapes.OVAL, { x: -2, y: 3.5, w: 5, h: 5, fill: { color: CYAN, transparency: 90 } });

  slide.addText("What's Next", {
    x: 0.8, y: 0.4, w: 8.4, h: 0.8,
    fontSize: 36, fontFace: "Arial Black", color: WHITE,
    bold: true, align: "left", margin: 0,
  });

  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.8, y: 1.15, w: 1.5, h: 0.05,
    fill: { color: PURPLE },
  });

  const visions = [
    { title: "Multi-Agent Marketplace", desc: "Multiple competing GA agents with reputation-driven pricing.\nBest agents earn more work.", color: PURPLE },
    { title: "Cross-Chain Settlement", desc: "CCTP bridge to Ethereum/Solana for wider reach.\nPay from any chain, settle on Arc.", color: BLUE },
    { title: "Beyond Trading", desc: "Genetic optimization for any parameter space:\nDeFi yields, NFT pricing, risk models.", color: CYAN },
  ];

  visions.forEach((v, i) => {
    const yBase = 1.5 + i * 1.15;

    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0.8, y: yBase, w: 8.4, h: 0.95,
      fill: { color: BG_CARD },
      shadow: cardShadow(),
    });

    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0.8, y: yBase, w: 0.07, h: 0.95,
      fill: { color: v.color },
    });

    slide.addText(v.title, {
      x: 1.15, y: yBase + 0.08, w: 3.5, h: 0.35,
      fontSize: 18, fontFace: "Calibri", color: WHITE,
      bold: true, align: "left", margin: 0,
    });

    slide.addText(v.desc, {
      x: 1.15, y: yBase + 0.42, w: 7.5, h: 0.48,
      fontSize: 12, fontFace: "Calibri", color: MUTED,
      align: "left", margin: 0,
    });
  });

  // Footer / Contact
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 4.9, w: 10, h: 0.725,
    fill: { color: "0D1230" },
  });
  slide.addText([
    { text: "0xSanei", options: { bold: true, color: WHITE } },
    { text: "  |  github.com/0xSanei  |  Built with ", options: { color: MUTED } },
    { text: "Darwinia GA", options: { bold: true, color: CYAN } },
    { text: " (101\u2B50)", options: { color: MUTED } },
  ], {
    x: 0.8, y: 4.9, w: 8.4, h: 0.725,
    fontSize: 13, fontFace: "Calibri",
    align: "left", valign: "middle", margin: 0,
  });
}

pres.writeFile({ fileName: "D:\\Sanei\\darwinia-on-arc\\slides\\pitch-deck.pptx" })
  .then(() => console.log("pitch-deck.pptx created!"))
  .catch((err) => console.error(err));
