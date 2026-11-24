export function Features() {
  const features = [
    {
      icon: "🏷️",
      title: "Auto-tag anything you save",
      description: "Smart tagging organizes your content automatically.",
      gradient: "linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(139, 92, 246, 0.05))",
      border: "rgba(99, 102, 241, 0.2)",
    },
    {
      icon: "📅",
      title: "One-tap schedule",
      description: "Add items to your calendar with a single tap.",
      gradient: "linear-gradient(135deg, rgba(34, 211, 238, 0.08), rgba(6, 182, 212, 0.05))",
      border: "rgba(34, 211, 238, 0.2)",
    },
    {
      icon: "✅",
      title: "Get Sh*t Done",
      description: "Actually finish what you save.",
      gradient: "linear-gradient(135deg, rgba(168, 85, 247, 0.08), rgba(192, 132, 252, 0.05))",
      border: "rgba(168, 85, 247, 0.2)",
    },
  ]

  return (
    <section className="mx-auto max-w-7xl px-6 py-12 md:py-16 lg:py-20">
      <div className="grid gap-6 md:grid-cols-3 md:gap-8">
        {features.map((feature, index) => (
          <div
            key={index}
            className="group rounded-[28px] p-6 shadow-xl transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl md:rounded-[32px] md:p-8"
            style={{
              backdropFilter: "blur(24px)",
              WebkitBackdropFilter: "blur(24px)",
              background: feature.gradient,
              border: `1px solid ${feature.border}`,
            }}
          >
            <div className="mb-4 text-4xl">{feature.icon}</div>
            <h3 className="mb-2 text-lg font-bold" style={{ color: "#0F172A" }}>
              {feature.title}
            </h3>
            <p className="text-sm leading-relaxed" style={{ color: "#64748B" }}>
              {feature.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
