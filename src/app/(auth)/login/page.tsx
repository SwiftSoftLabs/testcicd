import LoginForm from "./login-form";

export default function LoginPage() {
  return (
    <div className="min-h-screen w-full bg-[#0d1117] flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Background Decorations */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden">
        <div className="absolute -top-[10%] -left-[10%] size-[600px] bg-primary/10 rounded-full blur-[120px]"></div>
        <div className="absolute -bottom-[10%] -right-[10%] size-[600px] bg-purple-500/10 rounded-full blur-[120px]"></div>
      </div>

      <div className="w-full max-w-md z-10">
        <div className="text-center mb-10">
          <div className="inline-flex size-16 bg-primary rounded-2xl items-center justify-center shadow-2xl shadow-primary/20 mb-6">
            <span
              className="material-symbols-outlined text-white text-4xl"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              layers
            </span>
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight">
            OneWork
          </h1>
          <p className="text-text-secondary mt-2">
            The high-performance workspace for elite teams.
          </p>
        </div>

        <LoginForm />
      </div>
    </div>
  );
}
