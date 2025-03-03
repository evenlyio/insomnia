import { autoBindMethodsForReact } from 'class-autobind-decorator';
import classnames from 'classnames';
import React, { Fragment, PureComponent, ReactNode } from 'react';
import { connect } from 'react-redux';
import { AnyAction, bindActionCreators, Dispatch } from 'redux';

import { SegmentEvent, trackSegmentEvent, vcsSegmentEventProperties } from '../../../common/analytics';
import { AUTOBIND_CFG } from '../../../common/constants';
import { database as db } from '../../../common/database';
import { docsGitSync } from '../../../common/documentation';
import { isNotNullOrUndefined } from '../../../common/misc';
import * as models from '../../../models';
import type { GitRepository } from '../../../models/git-repository';
import type { Workspace } from '../../../models/workspace';
import type { GitLogEntry, GitVCS } from '../../../sync/git/git-vcs';
import { MemClient } from '../../../sync/git/mem-client';
import { getOauth2FormatName } from '../../../sync/git/utils';
import { initialize as initializeEntities } from '../../redux/modules/entities';
import * as gitActions from '../../redux/modules/git';
import { type DropdownHandle, Dropdown } from '../base/dropdown/dropdown';
import { DropdownButton } from '../base/dropdown/dropdown-button';
import { DropdownDivider } from '../base/dropdown/dropdown-divider';
import { DropdownItem } from '../base/dropdown/dropdown-item';
import { Link } from '../base/link';
import { HelpTooltip } from '../help-tooltip';
import { showAlert, showError, showModal } from '../modals';
import { GitBranchesModal } from '../modals/git-branches-modal';
import { GitLogModal } from '../modals/git-log-modal';
import { GitStagingModal } from '../modals/git-staging-modal';

type Props = ReturnType<typeof mapDispatchToProps> & {
  workspace: Workspace;
  vcs: GitVCS;
  gitRepository: GitRepository | null;
  className?: string;
  renderDropdownButton?: (children: ReactNode) => ReactNode;
};

interface State {
  initializing: boolean;
  loadingPush: boolean;
  loadingPull: boolean;
  log: GitLogEntry[];
  branch: string;
  branches: string[];
}

@autoBindMethodsForReact(AUTOBIND_CFG)
class GitSyncDropdown extends PureComponent<Props, State> {
  _dropdown: DropdownHandle | null = null;

  state: State = {
    initializing: false,
    loadingPush: false,
    loadingPull: false,
    log: [],
    branch: '',
    branches: [],
  };

  _setDropdownRef(dropdown: DropdownHandle) {
    this._dropdown = dropdown;
  }

  async _refreshState(otherState?: Record<string, any>) {
    const { vcs, workspace } = this.props;
    const workspaceMeta = await models.workspaceMeta.getOrCreateByParentId(workspace._id);

    // Clear cached items and return if no state
    if (!vcs.isInitialized() || !workspaceMeta.gitRepositoryId) {
      // Don't update unnecessarily
      const needsUpdate = [
        workspaceMeta.cachedGitRepositoryBranch,
        workspaceMeta.cachedGitLastAuthor,
        workspaceMeta.cachedGitLastCommitTime,
      ].some(isNotNullOrUndefined);

      if (needsUpdate) {
        await models.workspaceMeta.updateByParentId(workspace._id, {
          cachedGitRepositoryBranch: null,
          cachedGitLastAuthor: null,
          cachedGitLastCommitTime: null,
        });
      }

      return;
    }

    const branch = await vcs.getBranch();
    const branches = await vcs.listBranches();
    const log = (await vcs.log()) || [];
    this.setState({ ...(otherState || {}), log, branch, branches });
    const author = log[0] ? log[0].commit.author : null;
    const cachedGitRepositoryBranch = branch;
    const cachedGitLastAuthor = author ? author.name : null;
    // NOTE: We're converting timestamp to ms here
    const cachedGitLastCommitTime = author ? author.timestamp * 1000 : null;
    await models.workspaceMeta.updateByParentId(workspace._id, {
      cachedGitRepositoryBranch,
      cachedGitLastAuthor,
      cachedGitLastCommitTime,
    });
  }

  async _handleOpen() {
    await this._refreshState();
  }

  async _handlePull() {
    this.setState({
      loadingPull: true,
    });
    const { vcs, gitRepository } = this.props;

    if (!gitRepository) {
      // Should never happen
      throw new Error('Tried to pull without configuring git repo');
    }

    const bufferId = await db.bufferChanges();
    const providerName = getOauth2FormatName(gitRepository.credentials);
    try {
      await vcs.pull(gitRepository.credentials);
      trackSegmentEvent(SegmentEvent.vcsAction, { ...vcsSegmentEventProperties('git', 'pull'), providerName });
    } catch (err) {
      showError({
        title: 'Error Pulling Repository',
        error: err,
      });
      trackSegmentEvent(SegmentEvent.vcsAction, vcsSegmentEventProperties('git', 'pull', err.message));
    }

    await db.flushChanges(bufferId);
    this.setState({
      loadingPull: false,
    });
  }

  async _handlePush(_e: unknown, force = false) {
    this.setState({
      loadingPush: true,
    });
    const { vcs, gitRepository } = this.props;

    if (!gitRepository) {
      // Should never happen
      throw new Error('Tried to push without configuring git repo');
    }

    // Check if there is anything to push
    let canPush = false;

    try {
      canPush = await vcs.canPush(gitRepository.credentials);
    } catch (err) {
      showError({
        title: 'Error Pushing Repository',
        error: err,
      });
      this.setState({
        loadingPush: false,
      });
      return;
    }

    // If nothing to push, display that to the user
    if (!canPush) {
      showAlert({
        title: 'Push Skipped',
        message: 'Everything up-to-date. Nothing was pushed to the remote',
      });
      this.setState({
        loadingPush: false,
      });
      return;
    }

    const bufferId = await db.bufferChanges();
    const providerName = getOauth2FormatName(gitRepository.credentials);
    try {
      await vcs.push(gitRepository.credentials, force);
      trackSegmentEvent(SegmentEvent.vcsAction, { ...vcsSegmentEventProperties('git', force ? 'force_push' : 'push'), providerName });
    } catch (err) {
      if (err.code === 'PushRejectedError') {
        this._dropdown?.hide();
        showAlert({
          title: 'Push Rejected',
          message: 'Do you want to force push?',
          okLabel: 'Force Push',
          addCancel: true,
          onConfirm: () => {
            this._handlePush(null, true);
          },
        });
      } else {
        showError({
          title: 'Error Pushing Repository',
          error: err,
        });
        trackSegmentEvent(SegmentEvent.vcsAction, { ...vcsSegmentEventProperties('git', force ? 'force_push' : 'push', err.message), providerName });
      }
    }

    await db.flushChanges(bufferId);
    this.setState({
      loadingPush: false,
    });
  }

  _handleConfig() {
    const { gitRepository, workspace, updateGitRepository, setupGitRepository } = this.props;

    if (gitRepository) {
      updateGitRepository({
        gitRepository,
      });
    } else {
      setupGitRepository({
        workspace,
        createFsClient: MemClient.createClient,
      });
    }
  }

  _handleLog() {
    showModal(GitLogModal);
  }

  async _handleCommit() {
    const { gitRepository } = this.props;
    showModal(GitStagingModal, {
      onCommit: this._refreshState,
      gitRepository,
    });
  }

  _handleManageBranches() {
    showModal(GitBranchesModal, {
      onHide: this._refreshState,
    });
  }

  async _handleCheckoutBranch(branch: string) {
    const { vcs, handleInitializeEntities } = this.props;
    const bufferId = await db.bufferChanges();

    try {
      await vcs.checkout(branch);
    } catch (err) {
      showError({
        title: 'Checkout Error',
        error: err,
      });
    }

    await db.flushChanges(bufferId, true);
    await handleInitializeEntities();
    await this._refreshState();
  }

  _getProviderIconClassName(): string | undefined {
    const { gitRepository } = this.props;
    const providerName = getOauth2FormatName(gitRepository?.credentials);

    if (providerName === 'github') {
      return 'fa fa-github';
    }

    if (providerName === 'gitlab') {
      return 'fa fa-gitlab';
    }

    return;
  }

  componentDidMount() {
    this._refreshState();
  }

  renderButton() {
    const { branch } = this.state;
    const { vcs, renderDropdownButton } = this.props;

    const renderBtn =
      renderDropdownButton ||
      (children => (
        <DropdownButton className="btn btn--compact wide text-left overflow-hidden row-spaced" name="git-sync-dropdown-btn">
          {children}
        </DropdownButton>
      ));

    if (!vcs.isInitialized()) {
      return renderBtn(
        <Fragment>
          <i className="fa fa-code-fork space-right" />
          Setup Git Sync
        </Fragment>,
      );
    }

    const initializing = false;
    const iconClassName = this._getProviderIconClassName();
    return renderBtn(
      <Fragment>
        {iconClassName && <i className={classnames('space-right', iconClassName)} />}
        <div className="ellipsis">{initializing ? 'Initializing...' : branch}</div>
        <i className="fa fa-code-fork space-left" />
      </Fragment>,
    );
  }

  renderBranch(branch: string) {
    const { branch: currentBranch } = this.state;
    const icon =
      branch === currentBranch ? <i className="fa fa-tag" /> : <i className="fa fa-empty" />;
    const isCurrentBranch = branch === currentBranch;
    return (
      // @ts-expect-error -- TSCONVERSION
      <DropdownItem
        key={branch}
        onClick={isCurrentBranch ? null : () => this._handleCheckoutBranch(branch)}
        className={classnames({
          bold: isCurrentBranch,
        })}
        title={isCurrentBranch ? null : `Switch to "${branch}"`}
      >
        {icon}
        {branch}
      </DropdownItem>
    );
  }

  render() {
    const { className, vcs } = this.props;
    const { log, branches, branch, loadingPull, loadingPush } = this.state;
    return (
      <div className={className}>
        <Dropdown className="wide tall" onOpen={this._handleOpen} ref={this._setDropdownRef}>
          {this.renderButton()}

          <DropdownDivider>
            Git Sync
            <HelpTooltip>
              Sync and collaborate with Git{' '}
              <Link href={docsGitSync}>
                <span className="no-wrap">
                  <br />
                  Documentation <i className="fa fa-external-link" />
                </span>
              </Link>
            </HelpTooltip>
          </DropdownDivider>

          <DropdownItem onClick={this._handleConfig}>
            <i className="fa fa-wrench" /> Repository Settings
          </DropdownItem>

          {vcs.isInitialized() && (
            <Fragment>
              <DropdownItem onClick={this._handleManageBranches}>
                <i className="fa fa-code-fork" /> Branches
              </DropdownItem>
            </Fragment>
          )}

          {vcs.isInitialized() && (
            <Fragment>
              <DropdownDivider>Branches</DropdownDivider>
              {branches.map(this.renderBranch)}

              <DropdownDivider>{branch}</DropdownDivider>

              <DropdownItem onClick={this._handleCommit}>
                <i className="fa fa-check" /> Commit
              </DropdownItem>
              {log.length > 0 && (
                <DropdownItem onClick={this._handlePush} stayOpenAfterClick>
                  <i
                    className={classnames({
                      fa: true,
                      'fa-spin fa-refresh': loadingPush,
                      'fa-cloud-upload': !loadingPush,
                    })}
                  />{' '}
                  Push
                </DropdownItem>
              )}
              <DropdownItem onClick={this._handlePull} stayOpenAfterClick>
                <i
                  className={classnames({
                    fa: true,
                    'fa-spin fa-refresh': loadingPull,
                    'fa-cloud-download': !loadingPull,
                  })}
                />{' '}
                Pull
              </DropdownItem>
              <DropdownItem onClick={this._handleLog} disabled={log.length === 0}>
                <i className="fa fa-clock-o" /> History ({log.length})
              </DropdownItem>
            </Fragment>
          )}
        </Dropdown>
      </div>
    );
  }
}

function mapDispatchToProps(dispatch: Dispatch<AnyAction>) {
  const boundGitActions = bindActionCreators({ ...gitActions, initializeEntities }, dispatch);
  return {
    setupGitRepository: boundGitActions.setupGitRepository,
    updateGitRepository: boundGitActions.updateGitRepository,
    handleInitializeEntities: boundGitActions.initializeEntities,
  };
}

export default connect(null, mapDispatchToProps)(GitSyncDropdown);
