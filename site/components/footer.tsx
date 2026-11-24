import Link from "next/link"

export function Footer() {
  return (
    <footer className="mx-auto max-w-[1100px] px-6 py-12">
      <div className="flex flex-wrap items-center justify-center gap-2 text-sm" style={{ color: "#475569" }}>
        <span>© Silo</span>
        <span>·</span>
        <span>
          Made with ❤️ by{" "}
          <a
            href="https://munshi.lol"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:opacity-70"
          >
            munshi
          </a>
        </span>
        <span>·</span>
        <Link href="/privacy" className="transition-colors hover:opacity-70">
          Privacy
        </Link>
        <span>·</span>
        <Link href="/terms" className="transition-colors hover:opacity-70">
          Terms
        </Link>
      </div>
    </footer>
  )
}
