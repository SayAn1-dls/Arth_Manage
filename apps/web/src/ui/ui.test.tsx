import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Badge, Button, FormErrorSummary, Input, Logo, MIN_LOCKUP_WIDTH, Select } from './index.js';

describe('Button', () => {
  it('is disabled and busy while loading, and does not fire clicks', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const btn = screen.getByRole('button', { name: /save/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('primary uses Ink on Ember, never white text', () => {
    render(<Button>Go</Button>);
    const cls = screen.getByRole('button').className;
    expect(cls).toContain('bg-ember');
    expect(cls).toContain('text-ink');
    expect(cls).not.toContain('text-white');
  });

  it('defaults to type=button so it never submits forms by accident', () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });
});

describe('form fields', () => {
  it('binds the label, hint and error to the control for assistive tech', () => {
    render(<Input label="Team name" hint="Shown to judges" error="Required" />);
    const input = screen.getByLabelText('Team name');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const described = input.getAttribute('aria-describedby')!.split(' ');
    expect(described).toHaveLength(2);
    expect(document.getElementById(described[1]!)).toHaveTextContent('Required');
  });

  it('does not mark a valid field invalid', () => {
    render(
      <Select label="Track">
        <option>Fintech</option>
      </Select>,
    );
    expect(screen.getByLabelText('Track')).not.toHaveAttribute('aria-invalid');
  });
});

describe('Badge', () => {
  it('conveys status with text, not colour alone', () => {
    render(<Badge tone="error">Missing evaluation</Badge>);
    expect(screen.getByText('Missing evaluation')).toBeInTheDocument();
  });
});

describe('FormErrorSummary', () => {
  it('links each error to its field and announces as an alert', () => {
    render(<FormErrorSummary issues={[{ fieldId: 'name', message: 'Name is required' }]} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Name is required' })).toHaveAttribute('href', '#name');
  });

  it('renders nothing when there are no issues', () => {
    const { container } = render(<FormErrorSummary issues={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Logo', () => {
  it('uses the feather mark below the 120px minimum lockup width', () => {
    render(<Logo width={MIN_LOCKUP_WIDTH - 1} />);
    expect(screen.getByAltText('Arthakram').getAttribute('src')).toContain('feather');
  });

  it('uses the full lockup at or above the minimum and never distorts it', () => {
    render(<Logo width={160} />);
    const img = screen.getByAltText('Arthakram');
    expect(img.getAttribute('src')).toContain('logo');
    expect(img).toHaveStyle({ height: 'auto' });
  });
});
