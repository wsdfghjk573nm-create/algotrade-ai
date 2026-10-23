import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AlgoTrade AI — Learn, Backtest & Paper-Trade Algorithms",
  description:
    "Educational algorithmic trading platform: build strategies, backtest honestly with costs and slippage, and practise with virtual money. Paper trading only — no real orders, no guaranteed returns.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
