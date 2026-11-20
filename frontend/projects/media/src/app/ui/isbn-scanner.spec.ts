import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DETECTOR_LOADER, Detector } from '../media/barcode';
import { setup } from '../testing';
import { IsbnScanner } from './isbn-scanner';

describe('IsbnScanner', () => {
  let stop: ReturnType<typeof vi.fn>;
  let getUserMedia: ReturnType<typeof vi.fn>;
  let reads: { rawValue: string }[][];
  let scanned: string[];
  let closed: (string | null)[];

  function create(): ComponentFixture<IsbnScanner> {
    const fixture = TestBed.createComponent(IsbnScanner);
    fixture.componentInstance.scanned.subscribe((v) => scanned.push(v));
    fixture.componentInstance.closed.subscribe((v) => closed.push(v));
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    stop = vi.fn();
    getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    // jsdom has no media playback.
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4);
    reads = [];
    scanned = [];
    closed = [];
    const detector: Detector = { detect: () => Promise.resolve(reads.shift() ?? []) };
    setup([], [{ provide: DETECTOR_LOADER, useValue: () => Promise.resolve(detector) }]);
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (navigator as { mediaDevices?: unknown }).mediaDevices;
  });

  it('opens the back camera and emits the first book ISBN it reads', async () => {
    reads = [[], [{ rawValue: '4006381333931' }], [{ rawValue: '9781635575637' }]];
    create();
    await vi.advanceTimersByTimeAsync(1000);
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    expect(scanned).toEqual(['9781635575637']);
    expect(closed).toEqual([]);
    expect(stop).toHaveBeenCalled();
  });

  it('closes on Cancel and stops the camera', async () => {
    const fixture = create();
    await vi.advanceTimersByTimeAsync(300);
    (
      fixture.nativeElement.querySelector('[data-testid="scan-cancel"]') as HTMLButtonElement
    ).click();
    await vi.advanceTimersByTimeAsync(300);
    expect(closed).toEqual([null]);
    expect(scanned).toEqual([]);
    expect(stop).toHaveBeenCalled();
  });

  it('reports a refused camera', async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
    create();
    await vi.advanceTimersByTimeAsync(10);
    expect(closed).toEqual(['scan.denied']);
  });
});
