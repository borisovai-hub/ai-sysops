import axios from 'axios';
import { loadAppConfig } from '../config/env.js';

/**
 * Make a GitLab API request.
 */
export async function gitlabApi(method: string, endpoint: string, data?: unknown): Promise<unknown> {
  const config = loadAppConfig();
  if (!config.gitlab_url || !config.gitlab_token) {
    throw new Error('GitLab URL или токен не настроены в config.json');
  }
  const url = `${config.gitlab_url}/api/v4${endpoint}`;
  const response = await axios({ method, url, headers: { 'PRIVATE-TOKEN': config.gitlab_token }, data, timeout: 15000 });
  return response.data;
}

/**
 * Push (create or update) a file in a GitLab repository.
 */
export async function pushFileToGitlab(
  projectId: number,
  filePath: string,
  content: string,
  branch: string,
  commitMessage: string,
): Promise<unknown> {
  const encodedPath = encodeURIComponent(filePath);
  const payload = { branch, content, commit_message: commitMessage };
  try {
    await gitlabApi('get', `/projects/${projectId}/repository/files/${encodedPath}?ref=${branch}`);
    return await gitlabApi('put', `/projects/${projectId}/repository/files/${encodedPath}`, payload);
  } catch (error: unknown) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return await gitlabApi('post', `/projects/${projectId}/repository/files/${encodedPath}`, payload);
    }
    throw error;
  }
}

/**
 * Delete a file from a GitLab repository. Silently ignores 404.
 */
export async function deleteFileFromGitlab(
  projectId: number,
  filePath: string,
  branch: string,
  commitMessage: string,
): Promise<void> {
  const encodedPath = encodeURIComponent(filePath);
  try {
    await gitlabApi('delete', `/projects/${projectId}/repository/files/${encodedPath}`, {
      branch,
      commit_message: commitMessage,
    });
  } catch (error: unknown) {
    if (axios.isAxiosError(error) && error.response?.status === 404) return;
    throw error;
  }
}

export interface CiVariableOptions {
  variable_type?: string;
  protected?: boolean;
  masked?: boolean;
}

/**
 * Set a CI/CD variable on a GitLab project (create or update).
 */
export async function setGitlabCiVariable(
  projectId: number,
  key: string,
  value: string,
  options: CiVariableOptions = {},
): Promise<unknown> {
  const payload = {
    key,
    value,
    variable_type: options.variable_type || 'env_var',
    protected: options.protected || false,
    masked: options.masked || false,
  };
  try {
    return await gitlabApi('post', `/projects/${projectId}/variables`, payload);
  } catch (error: unknown) {
    if (axios.isAxiosError(error) && error.response?.status === 400) {
      return await gitlabApi('put', `/projects/${projectId}/variables/${key}`, payload);
    }
    throw error;
  }
}
