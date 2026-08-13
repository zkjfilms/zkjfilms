"use client";

import { useRef, useState, type FormEvent } from "react";
import { SESSION_TYPES } from "@/lib/leads";
import TurnstileWidget, {
  type TurnstileWidgetHandle,
} from "@/components/TurnstileWidget";

type Status = "idle" | "loading" | "submitted" | "error";

type FormValues = {
  name: string;
  email: string;
  sessionType: string;
  message: string;
};

type FormErrors = Partial<Record<keyof FormValues, string>>;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(values: FormValues): FormErrors {
  const errors: FormErrors = {};

  if (!values.name.trim()) {
    errors.name = "Please enter your name.";
  }

  if (!values.email.trim()) {
    errors.email = "Please enter your email.";
  } else if (!EMAIL_REGEX.test(values.email.trim())) {
    errors.email = "Please enter a valid email address.";
  }

  if (!values.sessionType) {
    errors.sessionType = "Please select a session type.";
  }

  if (!values.message.trim()) {
    errors.message = "Please share a few details.";
  }

  return errors;
}

export default function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [errors, setErrors] = useState<FormErrors>({});
  const [form, setForm] = useState<FormValues>({
    name: "",
    email: "",
    sessionType: "",
    message: "",
  });
  const [turnstileToken, setTurnstileToken] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);

  function handleChange(
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >,
  ) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: undefined }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const validationErrors = validate(form);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    setStatus("loading");

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, turnstileToken }),
      });

      if (!response.ok) {
        let message = "Something went wrong sending your message. Please try again, or reach out directly using the details below.";
        try {
          const data: { error?: string } = await response.json();
          if (data?.error) {
            message = data.error;
          }
        } catch {
          // Body wasn't valid JSON — fall back to the generic message above.
        }
        setErrorMessage(message);
        turnstileRef.current?.reset();
        setStatus("error");
        return;
      }

      setStatus("submitted");
    } catch {
      setErrorMessage(
        "Something went wrong sending your message. Please try again, or reach out directly using the details below.",
      );
      turnstileRef.current?.reset();
      setStatus("error");
    }
  }

  if (status === "submitted") {
    return (
      <div className="border border-border px-6 py-10 text-center">
        <p className="font-serif text-2xl italic text-foreground">
          Thank you.
        </p>
        <p className="mt-3 text-muted">
          Your message has been received. I&rsquo;ll get back to you within a
          day or two.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-8">
      <div>
        <label
          htmlFor="name"
          className="block text-xs uppercase tracking-[0.15em] text-muted"
        >
          Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          value={form.name}
          onChange={handleChange}
          aria-invalid={Boolean(errors.name)}
          className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none transition-colors focus:border-accent"
        />
        {errors.name && (
          <p className="mt-2 text-xs text-red-700">{errors.name}</p>
        )}
      </div>

      <div>
        <label
          htmlFor="email"
          className="block text-xs uppercase tracking-[0.15em] text-muted"
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          value={form.email}
          onChange={handleChange}
          aria-invalid={Boolean(errors.email)}
          className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none transition-colors focus:border-accent"
        />
        {errors.email && (
          <p className="mt-2 text-xs text-red-700">{errors.email}</p>
        )}
      </div>

      <div>
        <label
          htmlFor="sessionType"
          className="block text-xs uppercase tracking-[0.15em] text-muted"
        >
          What kind of session are you interested in?
        </label>
        <select
          id="sessionType"
          name="sessionType"
          value={form.sessionType}
          onChange={handleChange}
          aria-invalid={Boolean(errors.sessionType)}
          className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none transition-colors focus:border-accent"
        >
          <option value="" disabled>
            Select one
          </option>
          {SESSION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        {errors.sessionType && (
          <p className="mt-2 text-xs text-red-700">{errors.sessionType}</p>
        )}
      </div>

      <div>
        <label
          htmlFor="message"
          className="block text-xs uppercase tracking-[0.15em] text-muted"
        >
          Tell me a bit about what you&rsquo;re picturing
        </label>
        <textarea
          id="message"
          name="message"
          rows={5}
          value={form.message}
          onChange={handleChange}
          aria-invalid={Boolean(errors.message)}
          className="mt-2 w-full resize-none border-b border-border bg-transparent py-2 text-foreground outline-none transition-colors focus:border-accent"
        />
        {errors.message && (
          <p className="mt-2 text-xs text-red-700">{errors.message}</p>
        )}
      </div>

      <TurnstileWidget ref={turnstileRef} onVerify={setTurnstileToken} />

      <div>
        <button
          type="submit"
          disabled={status === "loading" || !turnstileToken}
          className="mt-4 border border-foreground px-8 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "loading" ? "Sending…" : "Send Message"}
        </button>
        {status === "error" && (
          <p className="mt-3 text-xs text-red-700">{errorMessage}</p>
        )}
      </div>
    </form>
  );
}
