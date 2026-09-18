import {
  IconBell,
  IconList,
  IconSearch,
  IconSites,
} from "./icons";

const STEPS = [
  {
    icon: IconSearch,
    title: "Ask once, then scout",
    body: "A few quick questions, then Carter searches for you.",
  },
  {
    icon: IconSites,
    title: "Choose your sites",
    body: "Amazon, Etsy, or sites you add — set defaults in Profile.",
  },
  {
    icon: IconList,
    title: "Like, pass, or save",
    body: "Like or pass to train Carter's taste. Save to a list when you're ready to buy.",
  },
  {
    icon: IconBell,
    title: "Watch for price drops",
    body: "Like or pass to train Carter's taste. Save to a list when you're ready to buy.",
  },
] as const;

/** Display-only empty-state rundown — never persisted to chat history. */
export function ChatIntro() {
  return (
    <div className="chat-intro" aria-labelledby="chat-intro-heading">
      <p className="chat-intro-mark" id="chat-intro-heading">
        Carter
      </p>
      <p className="chat-intro-lede">
        A curious product scout that learns what you want.
      </p>
      <ul className="chat-intro-steps">
        {STEPS.map((step) => {
          const Icon = step.icon;
          return (
            <li key={step.title} className="chat-intro-step">
              <span className="chat-intro-step-icon">
                <Icon />
              </span>
              <div>
                <h3 className="chat-intro-step-title">{step.title}</h3>
                <p className="chat-intro-step-body">{step.body}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="chat-intro-cta">
        Tell Carter what you’re shopping for below to get started.
      </p>
    </div>
  );
}
