import React from 'react';
import {render, type RenderOptions} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {ThemeProvider} from '../context/ThemeContext';

type RenderWithProvidersOptions = RenderOptions & {
  route?: string;
};

export const renderWithProviders = (
  ui: React.ReactElement,
  {route = '/', ...options}: RenderWithProvidersOptions = {},
) => {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </ThemeProvider>,
    options,
  );
};
