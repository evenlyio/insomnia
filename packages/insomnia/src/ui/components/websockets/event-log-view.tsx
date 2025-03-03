import { format } from 'date-fns';
import { SvgIcon, SvgIconProps } from 'insomnia-components';
import React, { FC, useRef } from 'react';
import { useMeasure } from 'react-use';
import { useVirtual } from 'react-virtual';
import styled from 'styled-components';

import { WebSocketEvent } from '../../../main/network/websocket';

const Timestamp: FC<{ time: Date | number }> = ({ time }) => {
  const date = format(time, 'HH:mm:ss');
  return <>{date}</>;
};

interface Props {
  events: WebSocketEvent[];
  selectionId?: string;
  onSelect: (event: WebSocketEvent) => void;
}

const Divider = styled('div')({
  height: '100%',
  width: '1px',
  backgroundColor: 'var(--hl-md)',
});

const AutoSize = styled.div({
  flex: '1 0',
  overflow: 'hidden',
});

const Scrollable = styled.div({
  overflowY: 'scroll',
});

const HeadingRow = styled('div')({
  flex: '0 0 30px',
  display: 'flex',
  width: '100%',
  alignItems: 'center',
  borderBottom: '1px solid var(--hl-md)',
  paddingRight: 'var(--scrollbar-width)',
  boxSizing: 'border-box',
});

const Row = styled('div')<{ isActive: boolean }>(({ isActive }) => ({
  position: 'absolute',
  top: 0,
  left: 0,
  height: '30px',
  display: 'flex',
  width: '100%',
  alignItems: 'center',
  borderBottom: '1px solid var(--hl-md)',
  boxSizing: 'border-box',
  backgroundColor: isActive ? 'var(--hl-lg)' : 'transparent',
}));

const List = styled('div')({
  width: '100%',
  position: 'relative',
});

const EventLog = styled('div')({
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  borderTop: '1px solid var(--hl-md)',
});

const EventIconCell = styled('div')({
  flex: '0 0 15px',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  boxSizing: 'border-box',
  padding: 'var(--padding-xs)',
});

function getIcon(event: WebSocketEvent): SvgIconProps['icon'] {
  switch (event.type) {
    case 'message': {
      if (event.direction === 'OUTGOING') {
        return 'sent';
      } else {
        return 'receive';
      }
    }
    case 'open': {
      return 'checkmark-circle';
    }
    case 'close': {
      return 'disconnected';
    }
    case 'error': {
      return 'error';
    }
    default: {
      return 'bug';
    }
  }
}

const EventMessageCell = styled('div')({
  flex: '1 0',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  padding: 'var(--padding-xs)',
});

const getMessage = (event: WebSocketEvent): string => {
  switch (event.type) {
    case 'message': {
      return event.data.toString();
    }
    case 'open': {
      return 'Connected successfully';
    }
    case 'close': {
      return 'Disconnected';
    }
    case 'error': {
      return event.message;
    }
    default: {
      return 'Unknown event';
    }
  }
};

const EventTimestampCell = styled('div')({
  flex: '0 0 80px',
  padding: 'var(--padding-xs)',
});

export const EventLogView: FC<Props> = ({ events, onSelect, selectionId }) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtual({
    parentRef,
    size: events.length,
    estimateSize: React.useCallback(() => 30, []),
    overscan: 30,
    keyExtractor: index => events[index]._id,
  });

  const [autoSizeRef, { height }] = useMeasure<HTMLDivElement>();

  return (
    <EventLog>
      <HeadingRow>
        <EventIconCell>
          <div style={{ width: '13px' }} />
        </EventIconCell>
        <Divider />
        <EventMessageCell>Data</EventMessageCell>
        <Divider />
        <EventTimestampCell>Time</EventTimestampCell>
      </HeadingRow>
      <AutoSize ref={autoSizeRef}>
        <Scrollable style={{ height }} ref={parentRef}>
          <List
            style={{
              height: `${virtualizer.totalSize}px`,
            }}
          >
            {virtualizer.virtualItems.map(item => {
              const event = events[item.index];

              return (
                <Row
                  key={item.key}
                  onClick={() => onSelect(event)}
                  isActive={event._id === selectionId}
                  style={{
                    height: `${item.size}px`,
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <EventIconCell>
                    <SvgIcon icon={getIcon(event)} />
                  </EventIconCell>
                  <Divider />

                  <EventMessageCell>{getMessage(event)}</EventMessageCell>
                  <Divider />
                  <EventTimestampCell>
                    <Timestamp time={event.timestamp} />
                  </EventTimestampCell>
                </Row>
              );
            })}
          </List>
        </Scrollable>
      </AutoSize>
    </EventLog>
  );
};
