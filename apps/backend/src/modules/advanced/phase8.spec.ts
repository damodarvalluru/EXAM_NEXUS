import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EvaluationStatus } from '@examnexus/shared';
import { ReviewAnswerDto, SchedulePublicationDto } from './dto';

describe('Phase 8 evaluation and results inputs', () => {
  it('accepts fractional marks to two decimal places', async () => {
    const dto = plainToInstance(ReviewAnswerDto, {
      questionId: 'question-1',
      marks: 7.25,
      status: EvaluationStatus.COMPLETED,
    });
    expect(await validate(dto)).toEqual([]);
  });

  it('rejects marks with excessive precision', async () => {
    const dto = plainToInstance(ReviewAnswerDto, {
      questionId: 'question-1',
      marks: 7.256,
      status: EvaluationStatus.COMPLETED,
    });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'marks')).toBe(true);
  });

  it('requires a valid ISO publication time for scheduling', async () => {
    const valid = plainToInstance(SchedulePublicationDto, { publishAt: '2030-01-01T09:00:00.000Z' });
    expect(await validate(valid)).toEqual([]);
    const invalid = plainToInstance(SchedulePublicationDto, { publishAt: 'tomorrow' });
    expect((await validate(invalid)).some((error) => error.property === 'publishAt')).toBe(true);
  });
});
