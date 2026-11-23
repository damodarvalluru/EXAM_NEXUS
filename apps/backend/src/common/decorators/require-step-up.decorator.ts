import { SetMetadata } from '@nestjs/common';

export const REQUIRE_STEP_UP_KEY = 'requireStepUp';

/** Requires a recent second-factor proof, independent of the login method. */
export const RequireStepUp = () => SetMetadata(REQUIRE_STEP_UP_KEY, true);
